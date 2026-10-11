//! Source video colour facts and the ffmpeg filters that turn an HDR / Dolby Vision picture into
//! correct SDR (BT.709, limited range). Without this a PQ/HLG/IPT-PQ source encoded by libx264 comes
//! out washed out, or green/purple for Dolby Vision profile 5.

use std::path::Path;
use std::time::Duration;

use serde::Deserialize;
use tokio::process::Command;

/// Dynamic range of a source picture; wire names match `hdr_formats` in playback health reports.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HdrKind {
    Sdr,
    Hdr10,
    Hlg,
    /// `profile` is the Dolby Vision profile; `bl_compat` is `dv_bl_signal_compatibility_id`
    /// (0 = no compatible base layer, as in profile 5; 1 = HDR10; 2 = SDR; 4 = HLG).
    DolbyVision {
        profile: u8,
        bl_compat: u8,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct SourceVideo {
    pub codec: String,
    pub profile: Option<String>,
    pub width: u32,
    pub height: u32,
    pub fps: Option<u32>,
    pub bit_depth: u8,
    pub color_space: Option<String>,
    pub color_transfer: Option<String>,
    pub color_primaries: Option<String>,
    pub color_range: Option<String>,
    pub dv_profile: Option<u8>,
    pub dv_bl_compat: Option<u8>,
    /// Mastering display or content light level side data is present (HDR10 static metadata).
    pub has_hdr_metadata: bool,
}

impl SourceVideo {
    /// True when the picture is HDR that must be tone-mapped for an SDR output. Dolby Vision with an
    /// SDR base layer (profile 8.2, `bl_compat` 2) is already SDR once the RPU is ignored.
    pub fn needs_tone_map(&self) -> bool {
        !matches!(
            self.hdr(),
            HdrKind::Sdr | HdrKind::DolbyVision { bl_compat: 2, .. }
        )
    }

    pub fn hdr(&self) -> HdrKind {
        if let Some(profile) = self.dv_profile {
            return HdrKind::DolbyVision {
                profile,
                bl_compat: self.dv_bl_compat.unwrap_or(0),
            };
        }
        match self.color_transfer.as_deref() {
            Some("smpte2084") => HdrKind::Hdr10,
            Some("arib-std-b67") => HdrKind::Hlg,
            // Untagged transfer, but wide-gamut 10-bit with HDR10 static metadata: it is HDR10.
            None if self.has_hdr_metadata
                && self.bit_depth >= 10
                && self.color_primaries.as_deref() == Some("bt2020") =>
            {
                HdrKind::Hdr10
            }
            _ => HdrKind::Sdr,
        }
    }
}

#[derive(Deserialize)]
struct ProbeOut {
    #[serde(default)]
    streams: Vec<ProbeStream>,
}

#[derive(Deserialize)]
struct ProbeStream {
    codec_name: Option<String>,
    profile: Option<String>,
    width: Option<u32>,
    height: Option<u32>,
    pix_fmt: Option<String>,
    r_frame_rate: Option<String>,
    color_space: Option<String>,
    color_transfer: Option<String>,
    color_primaries: Option<String>,
    color_range: Option<String>,
    #[serde(default)]
    side_data_list: Vec<SideData>,
}

#[derive(Deserialize)]
struct SideData {
    side_data_type: Option<String>,
    dv_profile: Option<u8>,
    dv_bl_signal_compatibility_id: Option<u8>,
}

fn known(value: Option<String>) -> Option<String> {
    value.filter(|v| !v.is_empty() && v != "unknown")
}

/// Parses `ffprobe -show_streams -select_streams v:0 -of json` output.
pub fn parse_source_video(stdout: &[u8]) -> Option<SourceVideo> {
    let stream = serde_json::from_slice::<ProbeOut>(stdout)
        .ok()?
        .streams
        .into_iter()
        .next()?;
    let dovi = stream
        .side_data_list
        .iter()
        .find(|d| d.side_data_type.as_deref() == Some("DOVI configuration record"));
    let pix_fmt = stream.pix_fmt.unwrap_or_default();
    let bit_depth = if pix_fmt.contains("12") {
        12
    } else if pix_fmt.contains("10") {
        10
    } else {
        8
    };
    let fps = stream.r_frame_rate.and_then(|r| {
        let (n, d) = r.split_once('/')?;
        let (n, d) = (n.parse::<f64>().ok()?, d.parse::<f64>().ok()?);
        (d > 0.0).then(|| (n / d).round() as u32)
    });
    Some(SourceVideo {
        codec: stream.codec_name.unwrap_or_default(),
        profile: stream.profile,
        width: stream.width.unwrap_or(0),
        height: stream.height.unwrap_or(0),
        fps,
        bit_depth,
        color_space: known(stream.color_space),
        color_transfer: known(stream.color_transfer),
        color_primaries: known(stream.color_primaries),
        color_range: known(stream.color_range),
        dv_profile: dovi.and_then(|d| d.dv_profile),
        dv_bl_compat: dovi.and_then(|d| d.dv_bl_signal_compatibility_id),
        has_hdr_metadata: stream.side_data_list.iter().any(|d| {
            matches!(
                d.side_data_type.as_deref(),
                Some("Mastering display metadata" | "Content light level metadata")
            )
        }),
    })
}

/// Best-effort probe of the first video stream; `None` when ffprobe is missing or fails.
pub async fn probe_source_video(path: &Path) -> Option<SourceVideo> {
    let binary = std::env::var("PLAYARR_FFPROBE_BINARY").unwrap_or_else(|_| "ffprobe".to_string());
    let output = tokio::time::timeout(
        Duration::from_secs(8),
        Command::new(binary)
            .args([
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-show_streams",
                "-of",
                "json",
                "-i",
            ])
            .arg(path)
            .kill_on_drop(true)
            .output(),
    )
    .await
    .ok()?
    .ok()?;
    output
        .status
        .success()
        .then(|| parse_source_video(&output.stdout))
        .flatten()
}

/// Which tone-mapping filters this ffmpeg can actually run (see `TranscodeOrchestrator`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ToneMapSupport {
    /// `zscale` (libzimg) and `tonemap` are both present.
    pub zscale: bool,
    /// `libplacebo` is present, opted into, and a Vulkan self-test passed.
    pub libplacebo: bool,
}

impl Default for ToneMapSupport {
    fn default() -> Self {
        Self {
            zscale: true,
            libplacebo: false,
        }
    }
}

/// Peak (in units of the 100-nit reference white) the tone mapper assumes, so brightness does not
/// depend on per-frame metadata: 10 = 1000 nits, the usual mastering level of HDR10 and HLG titles.
const TONEMAP_PEAK: u32 = 10;

/// Filter fragment (comma-joined, no leading/trailing comma) that converts the source to 8-bit
/// yuv420p BT.709 limited range. Runs after the downscale so tone mapping works on fewer pixels.
///
/// * SDR (and Dolby Vision 8.2, whose base layer is SDR): only forces limited range (a full-range
///   source otherwise leaves yuvj420p).
/// * HDR10 / HLG / Dolby Vision with an HDR10 or HLG base layer: zscale + tonemap (hable).
/// * Dolby Vision without a compatible base layer (profile 5, IPT-PQ-C2): needs the RPU applied,
///   which only libplacebo does. Without it the best we can do is the PQ path, whose colours are
///   wrong for profile 5 (documented limit).
/// * No `zscale` in this ffmpeg: the range fix only; HDR then keeps its washed-out look.
pub fn sdr_filter(source: &SourceVideo, support: &ToneMapSupport) -> String {
    let range_only = "scale=out_range=tv".to_string();
    if !source.needs_tone_map() {
        return range_only;
    }
    let needs_rpu = matches!(source.hdr(), HdrKind::DolbyVision { bl_compat: 0, .. });
    if needs_rpu && support.libplacebo {
        return "libplacebo=tonemapping=bt.2390:colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv:format=yuv420p".to_string();
    }
    if !support.zscale {
        return range_only;
    }
    let hlg = matches!(
        source.hdr(),
        HdrKind::Hlg | HdrKind::DolbyVision { bl_compat: 4, .. }
    );
    let tin = if hlg { "arib-std-b67" } else { "smpte2084" };
    let rin = if source.color_range.as_deref() == Some("pc") {
        "full"
    } else {
        "limited"
    };
    // Input properties are forced: HDR sources are often untagged, and zscale refuses to guess.
    // Output primaries must be explicit (`p=2020`): without it zscale fails "no path between
    // colorspaces" on the linear RGB step.
    format!(
        "zscale=tin={tin}:pin=2020:min=2020_ncl:rin={rin}:t=linear:npl=100:p=2020,format=gbrpf32le,\
         zscale=p=709,tonemap=tonemap=hable:desat=0:peak={TONEMAP_PEAK},\
         zscale=t=709:m=709:r=tv,format=yuv420p"
    )
}

/// (matrix, primaries, transfer) of the output. BT.601 SDR sources keep their matrix.
fn sdr_output_colour(source: &SourceVideo) -> (String, String, String) {
    let sd = matches!(source.color_space.as_deref(), Some("smpte170m" | "bt470bg"))
        && !source.needs_tone_map();
    if sd {
        let m = source
            .color_space
            .as_deref()
            .unwrap_or("smpte170m")
            .to_string();
        let p = source.color_primaries.clone().unwrap_or_else(|| m.clone());
        (m, p, "smpte170m".to_string())
    } else {
        (
            "bt709".to_string(),
            "bt709".to_string(),
            "bt709".to_string(),
        )
    }
}

/// Encoder colour tags matching [`sdr_filter`].
pub fn sdr_colour_tags(source: &SourceVideo) -> Vec<String> {
    let (m, p, t) = sdr_output_colour(source);
    [
        "-colorspace",
        &m,
        "-color_primaries",
        &p,
        "-color_trc",
        &t,
        "-color_range",
        "tv",
    ]
    .map(String::from)
    .to_vec()
}

/// Last filter of the chain. Frame properties are what the encoder tags from on ffmpeg 7+, which
/// ignores the `-colorspace` family of encoder options when a filter has set the frame's own.
pub fn sdr_setparams(source: &SourceVideo) -> String {
    let (m, p, t) = sdr_output_colour(source);
    format!("setparams=colorspace={m}:color_primaries={p}:color_trc={t}:range=tv")
}

/// What the device says it can decode and show. `declared` is false for clients that predate the
/// capability fields; they keep the old behaviour except that Dolby Vision profile 5 is never copied.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct DeviceVideoCaps {
    pub declared: bool,
    /// `hdr10`, `hlg`, `dolby_vision`.
    pub hdr: Vec<String>,
    pub dv_profiles: Vec<u8>,
    pub max_bit_depth: Option<u8>,
    /// Lower-case `codec:profile` pairs, e.g. `hevc:main 10`. Empty means any profile.
    pub video_profiles: Vec<String>,
    pub max_width: Option<u32>,
    pub max_height: Option<u32>,
    pub max_fps: Option<u32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VideoPlan {
    /// Keep the picture; `strip_dovi` drops the Dolby Vision RPU for a non-DV device.
    Copy { strip_dovi: bool },
    /// Re-encode to SDR BT.709 (tone-mapping HDR as needed).
    Transcode,
}

/// Decides how the picture reaches the device. `codec_supported` is the existing codec match.
/// `force_direct` (the "Force direct video" setting) copies the picture whatever the checks say.
pub fn plan_video(
    source: &SourceVideo,
    codec_supported: bool,
    caps: &DeviceVideoCaps,
    force_direct: bool,
) -> VideoPlan {
    if force_direct {
        return VideoPlan::Copy { strip_dovi: false };
    }
    if !codec_supported {
        return VideoPlan::Transcode;
    }
    let hdr = source.hdr();
    let hdr_has = |name: &str| caps.hdr.iter().any(|h| h == name);
    if let HdrKind::DolbyVision { profile, bl_compat } = hdr {
        // Legacy clients keep the legacy behaviour, Dolby Vision included.
        if !caps.declared {
            return VideoPlan::Copy { strip_dovi: false };
        }
        if hdr_has("dolby_vision") && caps.dv_profiles.contains(&profile) {
            return fits(source, caps, VideoPlan::Copy { strip_dovi: false });
        }
        // Without a compatible base layer (profile 5) the picture is unreadable unless the
        // device renders Dolby Vision itself.
        let base_ok = match bl_compat {
            // 1: HDR10 base layer; 6: UHD Blu-ray HDR10 base layer (profile 7).
            1 | 6 => hdr_has("hdr10"),
            2 => true,
            4 => hdr_has("hlg"),
            _ => false,
        };
        return if base_ok {
            fits(source, caps, VideoPlan::Copy { strip_dovi: true })
        } else {
            VideoPlan::Transcode
        };
    }
    if !caps.declared {
        return VideoPlan::Copy { strip_dovi: false };
    }
    let shown = match hdr {
        HdrKind::Hdr10 => hdr_has("hdr10"),
        HdrKind::Hlg => hdr_has("hlg"),
        _ => true,
    };
    if shown {
        fits(source, caps, VideoPlan::Copy { strip_dovi: false })
    } else {
        VideoPlan::Transcode
    }
}

/// Bit depth, size, frame rate and profile limits of a declared device.
fn fits(source: &SourceVideo, caps: &DeviceVideoCaps, plan: VideoPlan) -> VideoPlan {
    if !caps.declared {
        return plan;
    }
    let over = |limit: Option<u32>, value: u32| limit.is_some_and(|l| value > l);
    let profile_ok = caps.video_profiles.is_empty() || {
        let want = format!(
            "{}:{}",
            crate::normalise_codec(&source.codec),
            source.profile.as_deref().unwrap_or("").to_ascii_lowercase()
        );
        source.profile.is_none() || caps.video_profiles.contains(&want)
    };
    if over(
        caps.max_bit_depth.map(u32::from),
        u32::from(source.bit_depth),
    ) || over(caps.max_width, source.width)
        || over(caps.max_height, source.height)
        || over(caps.max_fps, source.fps.unwrap_or(0))
        || !profile_ok
    {
        VideoPlan::Transcode
    } else {
        plan
    }
}

/// Audio capability of the device. `declared` is true once the client sent `max_channels`.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct DeviceAudioCaps {
    pub declared: bool,
    pub codecs: Vec<String>,
    pub passthrough: Vec<String>,
    pub max_channels: Option<u8>,
}

/// Whether the source audio track can be delivered as is (direct play). Anything else becomes AAC
/// with at most `max_channels`. Undeclared devices and "Force direct audio" always pass.
pub fn audio_direct_ok(
    codec: Option<&str>,
    channels: Option<u32>,
    caps: &DeviceAudioCaps,
    force_direct: bool,
) -> bool {
    if force_direct || !caps.declared {
        return true;
    }
    let (Some(codec), Some(channels)) = (codec, channels) else {
        return true;
    };
    let listed = caps
        .codecs
        .iter()
        .chain(caps.passthrough.iter())
        .any(|c| c.eq_ignore_ascii_case(codec));
    let fits = caps.max_channels.is_none_or(|m| channels <= u32::from(m));
    listed && fits
}

/// Probe results by (media file id, size). A successful probe is kept; a failed one is retried
/// after [`FAILED_PROBE_TTL`], so a file that was briefly unreadable is not stuck as "unknown".
#[derive(Default)]
pub struct ProbeCache {
    entries:
        std::collections::HashMap<(uuid::Uuid, u64), (Option<SourceVideo>, std::time::Instant)>,
}

const FAILED_PROBE_TTL: Duration = Duration::from_secs(60);
const PROBE_CACHE_CAP: usize = 512;

impl ProbeCache {
    /// `Some(result)` on a usable hit; `None` when the caller must probe.
    pub fn get(
        &self,
        key: (uuid::Uuid, u64),
        now: std::time::Instant,
    ) -> Option<Option<SourceVideo>> {
        let (value, at) = self.entries.get(&key)?;
        (value.is_some() || now.duration_since(*at) < FAILED_PROBE_TTL).then(|| value.clone())
    }

    pub fn put(
        &mut self,
        key: (uuid::Uuid, u64),
        value: Option<SourceVideo>,
        now: std::time::Instant,
    ) {
        if self.entries.len() >= PROBE_CACHE_CAP {
            self.entries.clear();
        }
        self.entries.insert(key, (value, now));
    }
}

/// True when `ffmpeg -filters` output lists the filter `name`.
fn lists_filter(stdout: &str, name: &str) -> bool {
    stdout
        .lines()
        .any(|line| line.split_whitespace().nth(1) == Some(name))
}

async fn run_quiet(binary: &str, args: &[&str], secs: u64) -> Option<std::process::Output> {
    tokio::time::timeout(
        Duration::from_secs(secs),
        Command::new(binary)
            .args(args)
            .stdin(std::process::Stdio::null())
            .kill_on_drop(true)
            .output(),
    )
    .await
    .ok()?
    .ok()
}

/// Detects the tone-mapping filters of `binary`. libplacebo is used only when `want_libplacebo`,
/// the filter exists and a tiny Vulkan job actually runs; any failure falls back to zscale.
pub async fn detect_tone_map_support(binary: &str, want_libplacebo: bool) -> ToneMapSupport {
    let Some(out) = run_quiet(binary, &["-hide_banner", "-filters"], 10).await else {
        return ToneMapSupport {
            zscale: false,
            libplacebo: false,
        };
    };
    let listing = String::from_utf8_lossy(&out.stdout);
    let libplacebo = want_libplacebo
        && lists_filter(&listing, "libplacebo")
        && run_quiet(
            binary,
            &[
                "-hide_banner",
                "-v",
                "error",
                "-init_hw_device",
                "vulkan=vk",
                "-filter_hw_device",
                "vk",
                "-f",
                "lavfi",
                "-i",
                "nullsrc=s=64x64:d=0.1",
                "-vf",
                "format=yuv420p10le,libplacebo=format=yuv420p",
                "-f",
                "null",
                "-",
            ],
            15,
        )
        .await
        .is_some_and(|o| o.status.success());
    ToneMapSupport {
        zscale: lists_filter(&listing, "zscale") && lists_filter(&listing, "tonemap"),
        libplacebo,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const LP: ToneMapSupport = ToneMapSupport {
        zscale: true,
        libplacebo: true,
    };
    const NOLP: ToneMapSupport = ToneMapSupport {
        zscale: true,
        libplacebo: false,
    };

    const DV5: &str = r#"{"streams":[{"codec_name":"hevc","profile":"Main 10","width":3840,"height":2160,
      "pix_fmt":"yuv420p10le","r_frame_rate":"24000/1001","color_range":"pc","color_space":"unknown",
      "side_data_list":[{"side_data_type":"DOVI configuration record","dv_profile":5,
      "dv_bl_signal_compatibility_id":0}]}]}"#;

    fn src(json: &str) -> SourceVideo {
        parse_source_video(json.as_bytes()).unwrap()
    }

    #[test]
    fn parses_dolby_vision_profile_5() {
        let s = src(DV5);
        assert_eq!(
            s.hdr(),
            HdrKind::DolbyVision {
                profile: 5,
                bl_compat: 0
            }
        );
        assert_eq!((s.bit_depth, s.fps, s.color_space), (10, Some(24), None));
    }

    #[test]
    fn hdr10_and_hlg_are_read_from_the_transfer() {
        let hdr10 = src(r#"{"streams":[{"pix_fmt":"yuv420p10le","color_transfer":"smpte2084"}]}"#);
        let hlg = src(r#"{"streams":[{"pix_fmt":"yuv420p10le","color_transfer":"arib-std-b67"}]}"#);
        assert_eq!(hdr10.hdr(), HdrKind::Hdr10);
        assert_eq!(hlg.hdr(), HdrKind::Hlg);
    }

    #[test]
    fn hdr10_is_tone_mapped_to_bt709_limited() {
        let f = sdr_filter(
            &src(r#"{"streams":[{"color_transfer":"smpte2084"}]}"#),
            &NOLP,
        );
        assert!(f.contains("tin=smpte2084") && f.contains("tonemap=tonemap=hable"));
        assert!(f.ends_with("zscale=t=709:m=709:r=tv,format=yuv420p"));
    }

    #[test]
    fn hlg_uses_the_hlg_input_transfer() {
        let f = sdr_filter(
            &src(r#"{"streams":[{"color_transfer":"arib-std-b67"}]}"#),
            &NOLP,
        );
        assert!(f.contains("tin=arib-std-b67"));
    }

    #[test]
    fn dv5_uses_libplacebo_when_available_else_the_pq_path() {
        let s = src(DV5);
        assert!(sdr_filter(&s, &LP).starts_with("libplacebo="));
        assert!(sdr_filter(&s, &NOLP).starts_with("zscale="));
    }

    #[test]
    fn dv8_with_hdr10_base_layer_never_needs_libplacebo() {
        let s = src(
            r#"{"streams":[{"color_transfer":"smpte2084","side_data_list":[
          {"side_data_type":"DOVI configuration record","dv_profile":8,"dv_bl_signal_compatibility_id":1}]}]}"#,
        );
        assert!(sdr_filter(&s, &LP).starts_with("zscale="));
    }

    #[test]
    fn sdr_only_forces_limited_range_and_tags_bt709() {
        let s = src(r#"{"streams":[{"color_range":"pc","pix_fmt":"yuvj420p"}]}"#);
        assert_eq!(sdr_filter(&s, &NOLP), "scale=out_range=tv");
        assert_eq!(sdr_colour_tags(&s)[..2], ["-colorspace", "bt709"]);
    }

    #[test]
    fn dv_8_2_with_an_sdr_base_layer_is_treated_as_sdr() {
        let s = dv(8, 2);
        assert!(!s.needs_tone_map());
        assert_eq!(sdr_filter(&s, &LP), "scale=out_range=tv");
        assert_eq!(sdr_colour_tags(&s)[1], "bt709");
        assert_eq!(
            sdr_setparams(&s),
            "setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv"
        );
        // A device without Dolby Vision strips the RPU and copies the SDR picture.
        assert_eq!(
            plan_video(&s, true, &caps(&[], &[]), false),
            VideoPlan::Copy { strip_dovi: true }
        );
    }

    #[test]
    fn without_zscale_hdr_only_gets_the_range_fix() {
        let s = src(r#"{"streams":[{"color_transfer":"smpte2084"}]}"#);
        let none = ToneMapSupport {
            zscale: false,
            libplacebo: false,
        };
        assert_eq!(sdr_filter(&s, &none), "scale=out_range=tv");
    }

    #[test]
    fn filter_listing_matches_whole_names() {
        let listing = " TS colorspace        V->V  Convert\n .S zscale            V->V  Apply\n .. tonemap_opencl    V->V  x\n";
        assert!(lists_filter(listing, "zscale"));
        assert!(!lists_filter(listing, "tonemap"));
        assert!(!lists_filter(listing, "libplacebo"));
    }

    #[test]
    fn dv7_with_a_uhd_bluray_hdr10_base_layer_strips_and_copies() {
        assert_eq!(
            plan_video(&dv(7, 6), true, &caps(&["hdr10"], &[]), false),
            VideoPlan::Copy { strip_dovi: true }
        );
        assert_eq!(
            plan_video(&dv(7, 6), true, &caps(&[], &[]), false),
            VideoPlan::Transcode
        );
    }

    #[test]
    fn untagged_bt2020_10_bit_with_mastering_metadata_is_hdr10() {
        let s = src(
            r#"{"streams":[{"pix_fmt":"yuv420p10le","color_primaries":"bt2020","side_data_list":[
            {"side_data_type":"Mastering display metadata"}]}]}"#,
        );
        assert_eq!(s.hdr(), HdrKind::Hdr10);
        assert!(s.needs_tone_map());
        // Without the metadata (or at 8 bit) it stays SDR.
        assert_eq!(
            src(r#"{"streams":[{"pix_fmt":"yuv420p10le","color_primaries":"bt2020"}]}"#).hdr(),
            HdrKind::Sdr
        );
    }

    #[test]
    fn failed_probes_are_retried_after_the_ttl_but_successes_are_kept() {
        let key = (uuid::Uuid::new_v4(), 1);
        let t0 = std::time::Instant::now();
        let mut cache = ProbeCache::default();
        assert!(cache.get(key, t0).is_none());
        cache.put(key, None, t0);
        assert_eq!(cache.get(key, t0 + Duration::from_secs(30)), Some(None));
        assert!(cache.get(key, t0 + Duration::from_secs(61)).is_none());
        cache.put(key, Some(SourceVideo::default()), t0);
        assert!(cache.get(key, t0 + Duration::from_secs(3600)).is_some());
    }

    #[test]
    fn tone_map_peak_is_fixed() {
        let s = src(r#"{"streams":[{"color_transfer":"smpte2084"}]}"#);
        assert!(sdr_filter(&s, &NOLP).contains("tonemap=tonemap=hable:desat=0:peak=10"));
    }

    #[test]
    fn bt601_sources_keep_their_matrix() {
        let s = src(r#"{"streams":[{"color_space":"smpte170m","color_primaries":"smpte170m"}]}"#);
        assert_eq!(sdr_colour_tags(&s)[1], "smpte170m");
    }

    fn caps(hdr: &[&str], dv: &[u8]) -> DeviceVideoCaps {
        DeviceVideoCaps {
            declared: true,
            hdr: hdr.iter().map(|h| h.to_string()).collect(),
            dv_profiles: dv.to_vec(),
            ..Default::default()
        }
    }

    fn dv(profile: u8, bl: u8) -> SourceVideo {
        src(&format!(
            r#"{{"streams":[{{"codec_name":"hevc","pix_fmt":"yuv420p10le","color_transfer":"smpte2084","side_data_list":[
            {{"side_data_type":"DOVI configuration record","dv_profile":{profile},"dv_bl_signal_compatibility_id":{bl}}}]}}]}}"#
        ))
    }

    #[test]
    fn dv5_is_tone_mapped_unless_the_device_declares_dv5() {
        let s = dv(5, 0);
        assert_eq!(
            plan_video(&s, true, &caps(&["hdr10"], &[]), false),
            VideoPlan::Transcode
        );
        // Undeclared (legacy) clients keep the legacy behaviour, Dolby Vision included.
        assert_eq!(
            plan_video(&dv(5, 0), true, &DeviceVideoCaps::default(), false),
            VideoPlan::Copy { strip_dovi: false }
        );
        assert_eq!(
            plan_video(&s, true, &caps(&["dolby_vision"], &[5]), false),
            VideoPlan::Copy { strip_dovi: false }
        );
    }

    #[test]
    fn dv8_to_an_hdr10_device_strips_the_rpu_and_copies() {
        assert_eq!(
            plan_video(&dv(8, 1), true, &caps(&["hdr10"], &[]), false),
            VideoPlan::Copy { strip_dovi: true }
        );
        assert_eq!(
            plan_video(&dv(8, 1), true, &caps(&["dolby_vision"], &[8]), false),
            VideoPlan::Copy { strip_dovi: false }
        );
    }

    #[test]
    fn hdr_reaching_an_sdr_device_is_tone_mapped() {
        let hdr10 = src(
            r#"{"streams":[{"codec_name":"hevc","pix_fmt":"yuv420p10le","color_transfer":"smpte2084"}]}"#,
        );
        assert_eq!(
            plan_video(&hdr10, true, &caps(&[], &[]), false),
            VideoPlan::Transcode
        );
        assert_eq!(
            plan_video(&hdr10, true, &caps(&["hdr10"], &[]), false),
            VideoPlan::Copy { strip_dovi: false }
        );
        // Legacy clients (no declaration) keep copying plain HDR10.
        assert_eq!(
            plan_video(&hdr10, true, &DeviceVideoCaps::default(), false),
            VideoPlan::Copy { strip_dovi: false }
        );
    }

    #[test]
    fn bit_depth_size_and_profile_limits_force_a_transcode() {
        let s = src(
            r#"{"streams":[{"codec_name":"hevc","profile":"Main 10","width":3840,"height":2160,"pix_fmt":"yuv420p10le"}]}"#,
        );
        let mut c = caps(&[], &[]);
        assert_eq!(
            plan_video(&s, true, &c, false),
            VideoPlan::Copy { strip_dovi: false }
        );
        c.max_bit_depth = Some(8);
        assert_eq!(plan_video(&s, true, &c, false), VideoPlan::Transcode);
        c.max_bit_depth = Some(10);
        c.max_height = Some(1080);
        assert_eq!(plan_video(&s, true, &c, false), VideoPlan::Transcode);
        c.max_height = None;
        c.video_profiles = vec!["hevc:main".to_string()];
        assert_eq!(plan_video(&s, true, &c, false), VideoPlan::Transcode);
        c.video_profiles.push("hevc:main 10".to_string());
        assert_eq!(
            plan_video(&s, true, &c, false),
            VideoPlan::Copy { strip_dovi: false }
        );
    }

    #[test]
    fn force_direct_video_overrides_everything_but_nothing_else() {
        assert_eq!(
            plan_video(&dv(5, 0), false, &caps(&[], &[]), true),
            VideoPlan::Copy { strip_dovi: false }
        );
        assert_eq!(
            plan_video(&dv(5, 0), false, &caps(&[], &[]), false),
            VideoPlan::Transcode
        );
    }

    #[test]
    fn truehd_to_a_stereo_device_is_not_direct() {
        let c = DeviceAudioCaps {
            declared: true,
            codecs: vec!["aac".into()],
            passthrough: vec![],
            max_channels: Some(2),
        };
        assert!(!audio_direct_ok(Some("truehd"), Some(8), &c, false));
        assert!(!audio_direct_ok(Some("aac"), Some(6), &c, false));
        assert!(audio_direct_ok(Some("aac"), Some(2), &c, false));
        assert!(audio_direct_ok(Some("truehd"), Some(8), &c, true));
        assert!(audio_direct_ok(
            Some("truehd"),
            Some(8),
            &DeviceAudioCaps::default(),
            false
        ));
        let pass = DeviceAudioCaps {
            passthrough: vec!["eac3".into()],
            max_channels: Some(8),
            ..c
        };
        assert!(audio_direct_ok(Some("eac3"), Some(6), &pass, false));
    }
}
