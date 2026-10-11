//! `playarr-transcode` — playback-time transcode decision-making
//! ([`TranscodeOrchestrator`]) and the background Tdarr dispatch path
//! ([`TdarrDispatcher`]).
//!
//! The orchestrator's three methods are meant to be tried in order, each
//! only reached if the previous one didn't resolve the request:
//! 1. [`TranscodeOrchestrator::can_direct_play`] — can the source
//!    `MediaFile` be served byte-for-byte? Cheapest, most common case.
//! 2. [`TranscodeOrchestrator::find_existing_rendition`] — is there
//!    already a ready [`playarr_model::Rendition`], produced either by
//!    the background Tdarr pipeline or a previous on-demand session?
//! 3. [`TranscodeOrchestrator::spawn_on_demand_transcode`] — last resort:
//!    start a new transcode just for this session.
//!
//! [`TranscodeSession`] state (create/lookup/expire) is kept in whatever
//! [`playarr_cache::CacheAndPubSub`] implementation the deployment is
//! wired with, rather than in `playarr-db` — sessions are ephemeral,
//! TTL'd, node-scoped process state, not durable rows.
//!
//! [`ActiveSessionCounter`] is a small in-process bridge between the two
//! halves of this crate: `TranscodeOrchestrator` increments/decrements it
//! as on-demand sessions come and go, and `TdarrDispatcher` reads it to
//! decide whether to throttle Tdarr's background workers. It deliberately
//! isn't derived by scanning the cache — [`playarr_cache::CacheAndPubSub`]
//! is a plain get/set/delete/pub-sub trait with no listing/count
//! primitive (see that crate's docs), and a hot per-session-lifecycle
//! counter belongs in-process rather than round-tripping a KV store on
//! every increment/decrement.
//!
//! The other bridge, optional and one-directional: `TranscodeOrchestrator`
//! can hold an [`mpsc::Sender<MediaFileImportEvent>`] (see
//! [`TranscodeOrchestrator::with_tdarr_notify`]) and fires one every time
//! [`TranscodeOrchestrator::spawn_on_demand_transcode`] starts a live
//! session — the same channel `TdarrDispatcher` already consumes for real
//! *arr import events. This is what turns "someone is watching this file
//! right now via a temporary, TTL'd ffmpeg session" into "Tdarr goes and
//! produces a durable, cached `Rendition` for it in the background" per
//! this crate's own three-step lookup order above: once that `Rendition`
//! is `Ready`, every subsequent playback request for the same file+profile
//! hits step 2 instead of re-paying for step 3. Fire-and-forget
//! (`try_send`, never awaited) so a full or absent channel (Tdarr not
//! configured, or a worker-role process not running in this deployment)
//! never affects playback itself — `TdarrDispatcher::dispatch_one` already
//! re-checks for an existing `Ready` rendition before doing any real work,
//! so redundant events from multiple concurrent on-demand sessions for the
//! same file are naturally deduplicated on the receiving end.
// `async_trait` expansions trip clippy::double_must_use on current stable.
#![allow(clippy::double_must_use)]

pub mod video;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use chrono::{DateTime, Utc};
use playarr_cache::CacheAndPubSub;
use playarr_db::RenditionRepo;
use playarr_model::{MediaFile, Rendition};
use playarr_tdarr_client::{AlterWorkerLimitRequest, ScanIndividualFileRequest, TdarrClient};
use serde::{Deserialize, Serialize};
use tokio::process::{Child, Command};
use tokio::sync::{mpsc, Mutex};
use tokio::sync::{OwnedSemaphorePermit, Semaphore};
use uuid::Uuid;

#[derive(Debug, thiserror::Error)]
pub enum TranscodeError {
    #[error(transparent)]
    Db(#[from] playarr_db::DbError),
    #[error("no on-demand transcode capacity available on this node")]
    NoCapacity,
    #[error("tdarr client error: {0}")]
    Tdarr(#[from] playarr_tdarr_client::TdarrClientError),
    #[error("cache error: {0}")]
    Cache(#[from] playarr_cache::CacheError),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error("failed to (de)serialize transcode session: {0}")]
    Serialize(#[from] serde_json::Error),
    #[error("could not fetch the external audio track: {0}")]
    ExternalAudio(String),
    /// The picture's colours depend on Dolby Vision metadata this node cannot apply in real time.
    #[error("this title's colour format can't be converted for this device")]
    UnsupportedColour,
}

/// What a requesting client can play natively — the input to
/// [`TranscodeOrchestrator::can_direct_play`]. Built by `playarr-api`'s
/// playback negotiation handler from client-reported capabilities
/// (codecs/containers/max bitrate) rather than looked up from a static
/// per-`ClientPlatform` table, since real-world support varies per device/
/// OS/app-version more than platform alone predicts.
#[derive(Debug, Clone)]
pub struct ClientCapabilities {
    pub supported_containers: Vec<String>,
    pub supported_video_codecs: Vec<String>,
    pub supported_audio_codecs: Vec<String>,
    pub max_bitrate_bps: Option<u64>,
}

/// A live on-demand transcode: an ffmpeg (or equivalent) process on some
/// node, producing an HLS/DASH-style segmented output that this session's
/// player is consuming as it's produced. Distinct from
/// [`playarr_model::Rendition`] — a `Rendition` is a durable, complete
/// output on disk; a `TranscodeSession` is the ephemeral in-progress state
/// of *producing* one (or streaming without ever fully persisting it, for
/// a single playback).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TranscodeSession {
    pub id: Uuid,
    pub media_file_id: Uuid,
    pub profile: String,
    /// Which cluster node is actually running the transcode process. In a
    /// multi-node deployment, segment requests for this session must be
    /// routed to this exact node — the process (and its in-progress
    /// output) does not exist anywhere else.
    pub owning_node_id: String,
    /// The highest segment index produced so far; lets a reconnecting
    /// player (or a load balancer routing a segment request) know how far
    /// along the session is without querying the transcode process
    /// directly.
    pub current_segment: u32,
    /// Sessions are not renewed indefinitely — an idle on-demand transcode
    /// past this deadline is eligible for cleanup regardless of whether
    /// the owning node has otherwise noticed the client disconnected.
    pub expires_at: DateTime<Utc>,
}

/// A resolved ffmpeg target: the concrete codec/bitrate settings a named
/// rendition `profile` string (e.g. `"h264-1080p-8mbps"`) maps to.
///
/// TODO: this hardcodes a small, fixed set of profiles as a first real
/// implementation. A production system would resolve `profile` against a
/// configurable bitrate ladder (per-deployment, admin-editable) living in
/// `playarr-config`/`playarr-model` rather than baked into this crate;
/// tracked as follow-up, not blocking, since `spawn_on_demand_transcode`
/// needs *some* concrete mapping to build a correct ffmpeg command today.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TranscodeTargetProfile {
    pub name: String,
    /// Display/selection height exposed to playback clients.
    pub height: u16,
    /// ffmpeg `-c:v` value, e.g. `"libx264"`.
    pub video_codec: String,
    /// ffmpeg `-c:a` value, e.g. `"aac"`.
    pub audio_codec: String,
    /// Relative bitrate within this profile's resolution tier.
    pub quality_level: TranscodeQualityLevel,
    pub video_bitrate_kbps: Option<u32>,
    pub audio_bitrate_kbps: Option<u32>,
}

/// Relative bitrate within a resolution tier.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TranscodeQualityLevel {
    Low,
    Medium,
    High,
}

impl TranscodeQualityLevel {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Low => "Low",
            Self::Medium => "Medium",
            Self::High => "High",
        }
    }
}

#[derive(Clone, Copy)]
struct TranscodeProfileSpec {
    name: &'static str,
    height: u16,
    quality_level: TranscodeQualityLevel,
    video_bitrate_kbps: u32,
    audio_bitrate_kbps: u32,
}

const SUPPORTED_PROFILE_SPECS: [TranscodeProfileSpec; 12] = [
    TranscodeProfileSpec {
        name: "h264-2160p-12mbps",
        height: 2160,
        quality_level: TranscodeQualityLevel::Low,
        video_bitrate_kbps: 12_000,
        audio_bitrate_kbps: 192,
    },
    TranscodeProfileSpec {
        name: "h264-2160p-20mbps",
        height: 2160,
        quality_level: TranscodeQualityLevel::Medium,
        video_bitrate_kbps: 20_000,
        audio_bitrate_kbps: 192,
    },
    TranscodeProfileSpec {
        name: "h264-2160p-35mbps",
        height: 2160,
        quality_level: TranscodeQualityLevel::High,
        video_bitrate_kbps: 35_000,
        audio_bitrate_kbps: 192,
    },
    TranscodeProfileSpec {
        name: "h264-1080p-4mbps",
        height: 1080,
        quality_level: TranscodeQualityLevel::Low,
        video_bitrate_kbps: 4_000,
        audio_bitrate_kbps: 128,
    },
    TranscodeProfileSpec {
        name: "h264-1080p-8mbps",
        height: 1080,
        quality_level: TranscodeQualityLevel::Medium,
        video_bitrate_kbps: 8_000,
        audio_bitrate_kbps: 192,
    },
    TranscodeProfileSpec {
        name: "h264-1080p-12mbps",
        height: 1080,
        quality_level: TranscodeQualityLevel::High,
        video_bitrate_kbps: 12_000,
        audio_bitrate_kbps: 192,
    },
    TranscodeProfileSpec {
        name: "h264-720p-2mbps",
        height: 720,
        quality_level: TranscodeQualityLevel::Low,
        video_bitrate_kbps: 2_000,
        audio_bitrate_kbps: 96,
    },
    TranscodeProfileSpec {
        name: "h264-720p-4mbps",
        height: 720,
        quality_level: TranscodeQualityLevel::Medium,
        video_bitrate_kbps: 4_000,
        audio_bitrate_kbps: 128,
    },
    TranscodeProfileSpec {
        name: "h264-720p-6mbps",
        height: 720,
        quality_level: TranscodeQualityLevel::High,
        video_bitrate_kbps: 6_000,
        audio_bitrate_kbps: 128,
    },
    TranscodeProfileSpec {
        name: "h264-480p-1mbps",
        height: 480,
        quality_level: TranscodeQualityLevel::Low,
        video_bitrate_kbps: 1_000,
        audio_bitrate_kbps: 96,
    },
    TranscodeProfileSpec {
        name: "h264-480p-2mbps",
        height: 480,
        quality_level: TranscodeQualityLevel::Medium,
        video_bitrate_kbps: 2_000,
        audio_bitrate_kbps: 96,
    },
    TranscodeProfileSpec {
        name: "h264-480p-3mbps",
        height: 480,
        quality_level: TranscodeQualityLevel::High,
        video_bitrate_kbps: 3_000,
        audio_bitrate_kbps: 128,
    },
];

impl TranscodeProfileSpec {
    fn resolve(self) -> TranscodeTargetProfile {
        TranscodeTargetProfile {
            name: self.name.to_string(),
            height: self.height,
            video_codec: "libx264".to_string(),
            audio_codec: "aac".to_string(),
            quality_level: self.quality_level,
            video_bitrate_kbps: Some(self.video_bitrate_kbps),
            audio_bitrate_kbps: Some(self.audio_bitrate_kbps),
        }
    }
}

impl TranscodeTargetProfile {
    /// The real rendition ladder this server can currently produce.
    ///
    /// Playback clients use this rather than maintaining a second,
    /// potentially fictional quality list. Rows are ordered by resolution
    /// from UHD to SD, with Low/Medium/High bitrates inside each row.
    pub fn supported() -> Vec<Self> {
        SUPPORTED_PROFILE_SPECS
            .into_iter()
            .map(TranscodeProfileSpec::resolve)
            .collect()
    }

    /// Resolves a named profile to concrete ffmpeg settings, falling back
    /// to a conservative default (H.264/AAC, 4Mbps video) for any name
    /// this crate doesn't recognize, rather than failing outright — an
    /// unrecognized profile name is still a request that should degrade to
    /// *something* playable rather than erroring the whole playback
    /// attempt.
    pub fn resolve(profile: &str) -> Self {
        if let Some(spec) = SUPPORTED_PROFILE_SPECS
            .iter()
            .find(|spec| spec.name == profile)
        {
            return spec.resolve();
        }

        Self {
            name: profile.to_string(),
            height: 720,
            video_codec: "libx264".to_string(),
            audio_codec: "aac".to_string(),
            quality_level: TranscodeQualityLevel::Medium,
            video_bitrate_kbps: Some(4000),
            audio_bitrate_kbps: Some(128),
        }
    }
}

/// Fixed HLS segment duration, in seconds, for on-demand output.
pub const HLS_SEGMENT_SECONDS: u32 = 4;

/// Audio layouts with a standard AAC channel configuration (6, 2, 1).
const AAC_CHANNEL_LAYOUTS_FILTER: &str = "aformat=channel_layouts=5.1|stereo|mono";
const DEFAULT_FFMPEG_THREADS: usize = 2;

/// On-demand renditions produced before this instant were encoded without HDR tone mapping.
static TONE_MAP_EPOCH: std::sync::LazyLock<DateTime<Utc>> = std::sync::LazyLock::new(|| {
    DateTime::parse_from_rfc3339("2026-10-12T00:00:00Z")
        .expect("valid epoch")
        .with_timezone(&Utc)
});

/// Per-request output choices from the device capability decision.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct StreamHints {
    /// Remove the Dolby Vision RPU while copying HEVC (the client cannot render Dolby Vision).
    pub strip_dovi: bool,
    /// Fold audio to at most this many channels (2 forces stereo); `None` keeps 5.1 available.
    pub max_audio_channels: Option<u8>,
    /// The device renders Dolby Vision profile 5 itself (or the viewer forced direct video), so a
    /// profile 5 picture may be copied untouched. Without it a copy of such a source is refused.
    pub dv_copy_allowed: bool,
}

impl StreamHints {
    fn audio_filter(self) -> &'static str {
        match self.max_audio_channels {
            Some(1) => "aformat=channel_layouts=mono",
            Some(2) => "aformat=channel_layouts=stereo|mono",
            _ => AAC_CHANNEL_LAYOUTS_FILTER,
        }
    }
}

/// Admission permits one on-demand slot is worth. A full video re-encode
/// takes a whole slot; a video-copy remux (audio-only encode) takes a
/// quarter, so several devices remuxing one title do not exhaust the node.
const PERMITS_PER_SLOT: u32 = 4;
const FULL_TRANSCODE_PERMITS: u32 = PERMITS_PER_SLOT;
const VIDEO_COPY_PERMITS: u32 = 1;

tokio::task_local! {
    /// Set by [`with_borrowed_admission`]: spawns inside the scope may exceed the node's limit.
    static BORROW_ADMISSION: bool;
}

/// Runs `future` so that any transcode it spawns on a full node borrows one slot over the limit instead of being
/// refused. For a viewer who is already admitted (they hold a link to a running transcode) and renegotiates: a
/// seek, an audio or a quality switch must never fail for capacity. The borrowed permits are forgotten again when
/// that transcode ends, so each admitted viewer holds at most one borrowed slot at a time.
pub async fn with_borrowed_admission<F: std::future::Future>(future: F) -> F::Output {
    BORROW_ADMISSION.scope(true, future).await
}

/// An admission slot held for a transcode's lifetime. A borrowed slot holds no permit: it is admitted over the
/// limit and never touches the semaphore, so the pool cannot grow.
#[derive(Debug)]
struct Slot {
    #[allow(dead_code)] // held only for its Drop, which returns the permits
    permit: Option<OwnedSemaphorePermit>,
}

/// How long a viewer who just stopped their transcode still counts as admitted.
const ADMISSION_GRACE: Duration = Duration::from_secs(30);

/// What a running on-demand transcode produces. Two playback requests with
/// the same key can read the same HLS output, so the second one attaches to
/// the running ffmpeg instead of spawning its own. The user is part of the
/// key: sharing never crosses accounts.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct SharedTranscodeKey {
    pub user_id: Uuid,
    pub media_file_id: Uuid,
    pub profile: String,
    pub audio_stream_index: Option<u32>,
    pub start_position_ms: u64,
    pub video_copy: bool,
    /// A stripped Dolby Vision RPU is a different stream from the original; they never share.
    pub strip_dovi: bool,
    /// The audio fold differs per device channel count.
    pub max_audio_channels: Option<u8>,
}

/// Builds the ffmpeg argv for transcoding `input_path` into an HLS
/// rendition under `output_dir`, per `profile`. Pure (no I/O, no process
/// spawning) so it's unit-testable without an ffmpeg binary on `PATH` —
/// [`TranscodeOrchestrator::spawn_on_demand_transcode`] is the only
/// production caller, and just hands these args straight to
/// `tokio::process::Command`.
///
/// Uses `-hls_playlist_type event` (not `vod`): the player is tailing this
/// playlist *while* it's being produced (see [`TranscodeSession`]'s docs),
/// so segments must never be pruned out of the list (`-hls_list_size 0`)
/// and the playlist must not claim to be complete (`#EXT-X-ENDLIST`) until
/// ffmpeg actually finishes.
pub fn build_ffmpeg_hls_args(
    input_path: &Path,
    profile: &TranscodeTargetProfile,
    output_dir: &Path,
) -> Vec<String> {
    build_ffmpeg_hls_args_at(input_path, profile, output_dir, 0)
}

/// Builds the same live HLS command as [`build_ffmpeg_hls_args`], starting
/// from an absolute position in the source file. The replacement playlist's
/// own media timeline still begins at zero; callers must carry
/// `start_position_ms` separately when presenting source-relative time.
pub fn build_ffmpeg_hls_args_at(
    input_path: &Path,
    profile: &TranscodeTargetProfile,
    output_dir: &Path,
    start_position_ms: u64,
) -> Vec<String> {
    build_ffmpeg_hls_args_at_with_audio(input_path, profile, output_dir, start_position_ms, None)
}

/// Builds a live HLS command with one explicitly selected source audio
/// stream. `audio_stream_index` is ffprobe's global stream index, so the
/// mapping remains correct even when subtitle/data streams appear between
/// video and audio streams in the container.
pub fn build_ffmpeg_hls_args_at_with_audio(
    input_path: &Path,
    profile: &TranscodeTargetProfile,
    output_dir: &Path,
    start_position_ms: u64,
    audio_stream_index: Option<u32>,
) -> Vec<String> {
    build_hls_args(
        input_path,
        profile,
        output_dir,
        start_position_ms,
        audio_stream_index,
        None,
        None,
        DEFAULT_FFMPEG_THREADS,
        None,
        video::ToneMapSupport::default(),
        StreamHints::default(),
    )
    .expect("no source video: no colour path to refuse")
}

/// An audio file outside the source container (a Dubarr dub track) that
/// replaces the source audio in an on-demand HLS transcode.
///
/// `path` is always a *local* file that Playarr itself already fetched (with
/// whatever credentials the remote needs), so no credential, header or
/// remote URL ever appears in ffmpeg's argument list (visible to anyone who
/// can read the process table).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExternalAudio {
    pub path: PathBuf,
}

/// Like [`build_ffmpeg_hls_args_at_with_audio`], but the audio comes from a
/// second input (`external`); the source video is mapped as usual and the
/// source audio is dropped.
pub fn build_ffmpeg_hls_args_at_with_external_audio(
    input_path: &Path,
    profile: &TranscodeTargetProfile,
    output_dir: &Path,
    start_position_ms: u64,
    external: &ExternalAudio,
) -> Vec<String> {
    build_hls_args(
        input_path,
        profile,
        output_dir,
        start_position_ms,
        None,
        Some(external),
        None,
        DEFAULT_FFMPEG_THREADS,
        None,
        video::ToneMapSupport::default(),
        StreamHints::default(),
    )
    .expect("no source video: no colour path to refuse")
}

/// How the source video is carried into an on-demand HLS session whose only
/// change is the audio (a Dubarr dub or another source audio track): the
/// video stream is copied, never re-encoded, and the session is packaged as
/// fragmented-MP4 HLS (the segment type every HEVC-capable player prefers).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct VideoCopy {
    /// The source video is HEVC and needs the `hvc1` sample tag so Apple
    /// players accept it in fragmented MP4.
    pub hevc: bool,
}

impl VideoCopy {
    /// `Some` when `source_codec` can be copied into fragmented-MP4 HLS
    /// (H.264 or HEVC); `None` for anything else, which must be transcoded.
    pub fn for_codec(source_codec: &str) -> Option<Self> {
        match normalise_codec(source_codec).as_str() {
            "h264" => Some(Self { hevc: false }),
            "hevc" => Some(Self { hevc: true }),
            _ => None,
        }
    }
}

/// Audio bitrate for the video-copy path. The source is typically a surround
/// mix, which sounds poor at the transcode ladder's stereo-sized 128 kbps.
const VIDEO_COPY_AUDIO_KBPS: u32 = 256;

/// Builds the video-copy HLS command: the first video stream is remuxed as-is,
/// the selected audio (`audio_stream_index` in the source, or `external`) is
/// encoded to AAC. Pure, like [`build_ffmpeg_hls_args`].
pub fn build_ffmpeg_hls_args_video_copy(
    input_path: &Path,
    output_dir: &Path,
    start_position_ms: u64,
    audio_stream_index: Option<u32>,
    external: Option<&ExternalAudio>,
    video: VideoCopy,
) -> Vec<String> {
    let profile = TranscodeTargetProfile::resolve("");
    build_hls_args(
        input_path,
        &profile,
        output_dir,
        start_position_ms,
        audio_stream_index,
        external,
        Some(video),
        DEFAULT_FFMPEG_THREADS,
        // The caller states the source is plain SDR (this builder is for dubs and tests).
        Some(&video::SourceVideo::default()),
        video::ToneMapSupport::default(),
        StreamHints::default(),
    )
    .expect("an SDR source has no colour path to refuse")
}

#[allow(clippy::too_many_arguments)]
fn build_hls_args(
    input_path: &Path,
    profile: &TranscodeTargetProfile,
    output_dir: &Path,
    start_position_ms: u64,
    audio_stream_index: Option<u32>,
    external: Option<&ExternalAudio>,
    video_copy: Option<VideoCopy>,
    ffmpeg_threads: usize,
    // `Some` on the production path: the probed source drives tone mapping and colour tags.
    source: Option<&video::SourceVideo>,
    tone_map: video::ToneMapSupport,
    hints: StreamHints,
) -> Result<Vec<String>, TranscodeError> {
    // Guard (owner ruling): a profile 5 / IPT-PQ-C2 picture only leaves here through libplacebo, which
    // applies the RPU, or as an untouched copy the device renders itself. Anything else is refused.
    if let Some(source) = source {
        if source.requires_rpu() && video_copy.is_some() && !hints.dv_copy_allowed {
            return Err(TranscodeError::UnsupportedColour);
        }
    } else if video_copy.is_some_and(|v| v.hevc) {
        // An HEVC copy with no probe could carry profile 5: unknown colours are never copied.
        return Err(TranscodeError::UnsupportedColour);
    }
    let mut args = vec![
        // Overwrite without prompting — the per-session output directory
        // is freshly created, but ffmpeg still probes for an existing
        // playlist file otherwise and this keeps it non-interactive.
        "-y".to_string(),
        // Bound decoder and filter workers before opening the input. Encoder
        // threads are set separately with the output video options below.
        "-threads:v".to_string(),
        ffmpeg_threads.to_string(),
        "-filter_threads".to_string(),
        ffmpeg_threads.to_string(),
        "-filter_complex_threads".to_string(),
        ffmpeg_threads.to_string(),
    ];

    let uses_libplacebo = video_copy.is_none()
        && source.is_some_and(
            |s| matches!(video::sdr_filter(s, &tone_map), Ok(f) if f.starts_with("libplacebo")),
        );
    if uses_libplacebo {
        args.extend(["-init_hw_device", "vulkan=vk", "-filter_hw_device", "vk"].map(String::from));
    }

    if start_position_ms > 0 {
        args.push("-ss".to_string());
        args.push(format!("{:.3}", start_position_ms as f64 / 1000.0));
    }

    args.extend(["-i".to_string(), input_path.to_string_lossy().into_owned()]);
    if let Some(ext) = external {
        // The dub is aligned to the original's timeline, so it is seeked to
        // the same absolute position as the video input.
        if start_position_ms > 0 {
            args.push("-ss".to_string());
            args.push(format!("{:.3}", start_position_ms as f64 / 1000.0));
        }
        args.push("-i".to_string());
        args.push(ext.path.to_string_lossy().into_owned());
    }
    match video_copy {
        Some(video) => {
            args.extend(["-c:v".to_string(), "copy".to_string()]);
            if video.hevc {
                args.extend(["-tag:v".to_string(), "hvc1".to_string()]);
                if hints.strip_dovi {
                    args.extend(["-bsf:v".to_string(), "dovi_rpu=strip=1".to_string()]);
                }
            }
        }
        None => args.extend([
            "-c:v".to_string(),
            profile.video_codec.clone(),
            "-threads:v".to_string(),
            ffmpeg_threads.to_string(),
            // Browser MSE implementations generally accept 8-bit H.264 but
            // reject High 10 output. Without an explicit pixel format, libx264
            // preserves a 10-bit source as yuv420p10le, which produces valid TS
            // segments that Chrome/Safari still fail to append (Shaka 3014/3015).
            "-pix_fmt".to_string(),
            "yuv420p".to_string(),
            // On-demand output must keep up with playback. libx264's default
            // `medium` preset runs a 4K HEVC source at about a quarter of
            // realtime on two threads, so the player stalls before the first
            // segment (TASKS 20.260); `veryfast` roughly doubles throughput.
            "-preset".to_string(),
            "veryfast".to_string(),
            // A keyframe on every segment boundary, so the first segment (and
            // the playlist) lands after HLS_SEGMENT_SECONDS of output rather
            // than at the encoder's default ~10 s GOP.
            "-force_key_frames".to_string(),
            format!("expr:gte(t,n_forced*{HLS_SEGMENT_SECONDS})"),
        ]),
    }
    args.extend([
        "-map".to_string(),
        "0:v:0".to_string(),
        "-map".to_string(),
        if external.is_some() {
            "1:a:0".to_string()
        } else {
            audio_stream_index
                .map(|stream_index| format!("0:{stream_index}"))
                .unwrap_or_else(|| "0:a:0?".to_string())
        },
        "-sn".to_string(),
    ]);

    // Fold any source layout onto one with a standard AAC channel
    // configuration. For layouts such as DTS 5.1(side) or 7.1, ffmpeg's AAC
    // encoder writes channel configuration 0 plus a PCE, which Android's AAC
    // decoder and Chrome's MSE reject (TASKS 20.260: "Decoder failed" and
    // Shaka 3014).
    let mut audio_filter = hints.audio_filter().to_string();
    if external.is_some() {
        // A dub can be shorter than the title (a partial run, or a seek past
        // its end). Pad it with silence so audio never runs out before the
        // video, and let the finite video stream end the output
        // (`-shortest`); otherwise ffmpeg emits no segments and the player
        // buffers forever.
        audio_filter.push_str(",apad");
        args.push("-shortest".to_string());
    }
    args.extend(["-af".to_string(), audio_filter]);

    if video_copy.is_none() {
        let mut chain = Vec::new();
        if profile.height > 0 {
            chain.push(format!("scale=-2:min({}\\,ih)", profile.height));
        }
        if let Some(source) = source {
            chain.push(
                video::sdr_filter(source, &tone_map)
                    .map_err(|_| TranscodeError::UnsupportedColour)?,
            );
            chain.push(video::sdr_setparams(source));
        }
        if !chain.is_empty() {
            args.push("-vf".to_string());
            args.push(chain.join(","));
        }
        if let Some(source) = source {
            args.extend(video::sdr_colour_tags(source));
        }
    }

    if let (None, Some(kbps)) = (video_copy, profile.video_bitrate_kbps) {
        args.push("-b:v".to_string());
        args.push(format!("{kbps}k"));
    }

    args.push("-c:a".to_string());
    args.push(profile.audio_codec.clone());

    let audio_kbps = if video_copy.is_some() {
        Some(VIDEO_COPY_AUDIO_KBPS)
    } else {
        profile.audio_bitrate_kbps
    };
    if let Some(kbps) = audio_kbps {
        args.push("-b:a".to_string());
        args.push(format!("{kbps}k"));
    }

    args.push("-f".to_string());
    args.push("hls".to_string());
    args.push("-hls_time".to_string());
    args.push(HLS_SEGMENT_SECONDS.to_string());
    args.push("-hls_playlist_type".to_string());
    args.push("event".to_string());
    args.push("-hls_list_size".to_string());
    args.push("0".to_string());
    let segment_name = if video_copy.is_some() {
        args.extend([
            "-hls_segment_type".to_string(),
            "fmp4".to_string(),
            "-hls_fmp4_init_filename".to_string(),
            "init.mp4".to_string(),
        ]);
        "segment_%05d.m4s"
    } else {
        "segment_%05d.ts"
    };
    args.push("-hls_segment_filename".to_string());
    args.push(output_dir.join(segment_name).to_string_lossy().into_owned());
    args.push(
        output_dir
            .join("playlist.m3u8")
            .to_string_lossy()
            .into_owned(),
    );

    Ok(args)
}

/// ffmpeg arguments for a downloadable single-file MP4 at `profile`: same picture rules as live
/// playback (downscale, HDR tone mapping, BT.709 tags, a refused profile 5 without libplacebo), but
/// one fast-start MP4 file instead of HLS segments. Pure, like [`build_ffmpeg_hls_args`].
pub fn build_download_args(
    input_path: &Path,
    profile: &TranscodeTargetProfile,
    output_path: &Path,
    ffmpeg_threads: usize,
    source: &video::SourceVideo,
    tone_map: video::ToneMapSupport,
    tracks: &DownloadTracks,
) -> Result<Vec<String>, TranscodeError> {
    let threads = ffmpeg_threads.to_string();
    let mut chain = Vec::new();
    if profile.height > 0 {
        chain.push(format!("scale=-2:min({}\\,ih)", profile.height));
    }
    chain
        .push(video::sdr_filter(source, &tone_map).map_err(|_| TranscodeError::UnsupportedColour)?);
    chain.push(video::sdr_setparams(source));
    let mut args: Vec<String> = ["-y", "-threads:v"]
        .iter()
        .map(|s| s.to_string())
        .chain([
            threads.clone(),
            "-filter_threads".into(),
            threads.clone(),
            "-i".into(),
            input_path.to_string_lossy().into_owned(),
            "-map".into(),
            "0:v:0".into(),
            "-map".into(),
            tracks
                .audio_stream_index
                .map_or_else(|| "0:a:0?".to_string(), |index| format!("0:{index}")),
        ])
        .collect();
    // Text subtitles the viewer could see in playback travel as MP4 timed text.
    for (index, _) in &tracks.subtitles {
        args.extend(["-map".into(), format!("0:{index}")]);
    }
    if tracks.subtitles.is_empty() {
        args.push("-sn".into());
    }
    args.extend(["-vf".into(), chain.join(",")]);
    if tone_map.libplacebo && source.requires_rpu() {
        args.splice(
            0..0,
            ["-init_hw_device", "vulkan=vk", "-filter_hw_device", "vk"].map(String::from),
        );
    }
    args.extend([
        "-c:v".into(),
        profile.video_codec.clone(),
        "-threads:v".into(),
        threads,
        "-pix_fmt".into(),
        "yuv420p".into(),
        "-preset".into(),
        "veryfast".into(),
    ]);
    if let Some(kbps) = profile.video_bitrate_kbps {
        args.extend(["-b:v".into(), format!("{kbps}k")]);
    }
    args.extend(video::sdr_colour_tags(source));
    args.extend([
        "-af".into(),
        AAC_CHANNEL_LAYOUTS_FILTER.to_string(),
        "-c:a".into(),
        profile.audio_codec.clone(),
    ]);
    if let Some(kbps) = profile.audio_bitrate_kbps {
        args.extend(["-b:a".into(), format!("{kbps}k")]);
    }
    if !tracks.subtitles.is_empty() {
        args.extend(["-c:s".into(), "mov_text".into()]);
        for (n, (_, language)) in tracks.subtitles.iter().enumerate() {
            if let Some(language) = language {
                args.extend([format!("-metadata:s:s:{n}"), format!("language={language}")]);
            }
        }
    }
    args.extend([
        "-movflags".into(),
        "+faststart".into(),
        "-f".into(),
        "mp4".into(),
        output_path.to_string_lossy().into_owned(),
    ]);
    Ok(args)
}

/// Which audio and subtitle tracks a download keeps: the audio playback would pick for the viewer,
/// and the text subtitles (stream index, language).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct DownloadTracks {
    pub audio_stream_index: Option<u32>,
    pub subtitles: Vec<(u32, Option<String>)>,
}

/// State shared between the orchestrator and a running download, so live playback can pause the
/// download to take its capacity.
struct DownloadShared {
    pid: std::sync::atomic::AtomicU32,
    /// The admission permits the download holds; `None` while it is paused for live playback.
    permit: std::sync::Mutex<Option<OwnedSemaphorePermit>>,
    paused: std::sync::atomic::AtomicBool,
}

/// Sends `sig` to `pid`; `false` when the process is gone or the signal was refused.
fn signal(pid: u32, sig: i32) -> bool {
    pid != 0
        && i32::try_from(pid).is_ok_and(|pid| {
            // SAFETY: `kill` only reads its two integer arguments.
            unsafe { libc::kill(pid, sig) == 0 }
        })
}

/// Permits a download needs available to start or resume. Live playback always wins: on a one-slot node
/// the node must be completely idle, on a larger one a whole slot must stay spare after the download.
fn download_admission_need(total_permits: usize) -> usize {
    if total_permits <= FULL_TRANSCODE_PERMITS as usize {
        FULL_TRANSCODE_PERMITS as usize
    } else {
        2 * FULL_TRANSCODE_PERMITS as usize
    }
}

/// Admission for a download, taken before its ticket is claimed. It is registered at once, so live
/// playback can take the slot back even while the download is still being set up (probing, claiming);
/// dropping it releases the permits and the registration.
pub struct DownloadReservation {
    shared: Option<Arc<DownloadShared>>,
    registry: Arc<std::sync::Mutex<Option<Arc<DownloadShared>>>>,
}

impl DownloadReservation {
    /// Whether live playback took the slot back (the download then starts paused).
    pub fn was_preempted(&self) -> bool {
        self.shared
            .as_ref()
            .is_some_and(|s| s.paused.load(Ordering::SeqCst))
    }

    fn into_shared(mut self) -> Arc<DownloadShared> {
        self.shared.take().expect("reservation not yet consumed")
    }
}

impl std::fmt::Debug for DownloadReservation {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("DownloadReservation")
    }
}

impl Drop for DownloadReservation {
    fn drop(&mut self) {
        if let (Some(shared), Ok(mut registry)) = (self.shared.take(), self.registry.lock()) {
            if registry.as_ref().is_some_and(|r| Arc::ptr_eq(r, &shared)) {
                *registry = None;
            }
        }
    }
}

/// Cloneable control over a running download: whether live playback paused it, and resuming it.
#[derive(Clone)]
pub struct DownloadHandle {
    shared: Arc<DownloadShared>,
    slots: Arc<Semaphore>,
    total_permits: usize,
}

impl DownloadHandle {
    /// Whether live playback has paused the download.
    pub fn is_paused(&self) -> bool {
        self.shared.paused.load(Ordering::SeqCst)
    }

    /// Resumes a paused download once the node has a spare slot again; `true` when it is running.
    pub async fn try_resume(&self) -> bool {
        if !self.is_paused() {
            return true;
        }
        if self.slots.available_permits() < download_admission_need(self.total_permits) {
            return false;
        }
        let Ok(permit) = self
            .slots
            .clone()
            .try_acquire_many_owned(FULL_TRANSCODE_PERMITS)
        else {
            return false;
        };
        let pid = self.shared.pid.load(Ordering::SeqCst);
        // Before ffmpeg exists there is nothing to continue; afterwards a refused SIGCONT keeps it paused.
        if pid != 0 && !signal(pid, libc::SIGCONT) {
            return false;
        }
        if let Ok(mut held) = self.shared.permit.lock() {
            *held = Some(permit);
        }
        self.shared.paused.store(false, Ordering::SeqCst);
        true
    }
}

/// A running download transcode. It holds a full admission slot, yields it to live playback by being
/// paused (SIGSTOP) and resumes (SIGCONT) when a spare slot returns.
pub struct DownloadJob {
    child: Child,
    handle: DownloadHandle,
    registry: Arc<std::sync::Mutex<Option<Arc<DownloadShared>>>>,
}

impl DownloadJob {
    /// Waits for ffmpeg to finish; `true` when it exited successfully.
    pub async fn wait(&mut self) -> bool {
        let ok = self.child.wait().await.is_ok_and(|status| status.success());
        // The process is gone: its pid must never be signalled again (it could be reused).
        self.deregister();
        ok
    }

    /// Stops ffmpeg for good (a canceled ticket).
    pub async fn kill(&mut self) {
        let _ = self.child.kill().await;
        self.deregister();
    }

    fn deregister(&self) {
        self.handle.shared.pid.store(0, Ordering::SeqCst);
        // The slot goes back at once, not when the job value is dropped.
        if let Ok(mut held) = self.handle.shared.permit.lock() {
            held.take();
        }
        if let Ok(mut registry) = self.registry.lock() {
            if registry
                .as_ref()
                .is_some_and(|r| Arc::ptr_eq(r, &self.handle.shared))
            {
                *registry = None;
            }
        }
    }

    /// A handle for pausing state and resuming, usable while [`Self::wait`] is pending.
    pub fn handle(&self) -> DownloadHandle {
        self.handle.clone()
    }

    pub fn is_paused(&self) -> bool {
        self.handle.is_paused()
    }

    pub async fn try_resume(&self) -> bool {
        self.handle.try_resume().await
    }
}

impl Drop for DownloadJob {
    fn drop(&mut self) {
        self.deregister();
    }
}

/// Shared, process-local count of active on-demand transcode sessions.
/// See the module docs for why this isn't derived from the cache.
#[derive(Debug, Clone, Default)]
pub struct ActiveSessionCounter(Arc<AtomicUsize>);

impl ActiveSessionCounter {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn get(&self) -> usize {
        self.0.load(Ordering::SeqCst)
    }

    pub fn increment(&self) -> usize {
        self.0.fetch_add(1, Ordering::SeqCst) + 1
    }

    /// Saturating decrement — never underflows below zero, so a stray
    /// double-decrement (e.g. racing cleanup paths) can't wrap around to
    /// `usize::MAX` and falsely report the node as saturated.
    pub fn decrement(&self) -> usize {
        let mut current = self.0.load(Ordering::SeqCst);
        loop {
            let next = current.saturating_sub(1);
            match self
                .0
                .compare_exchange_weak(current, next, Ordering::SeqCst, Ordering::SeqCst)
            {
                Ok(_) => return next,
                Err(actual) => current = actual,
            }
        }
    }
}

#[cfg(not(test))]
fn default_ffprobe_binary() -> String {
    video::default_ffprobe()
}

/// Tests never reach a real ffprobe: this stub reports a plain SDR HEVC stream for any file.
#[cfg(test)]
fn default_ffprobe_binary() -> String {
    use std::os::unix::fs::PermissionsExt;
    static STUB: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    STUB.get_or_init(|| {
        let path = std::env::temp_dir().join(format!("playarr-test-ffprobe-{}", std::process::id()));
        std::fs::write(
            &path,
            "#!/bin/sh\necho '{\"streams\":[{\"codec_name\":\"hevc\",\"pix_fmt\":\"yuv420p10le\"}]}'\n",
        )
        .unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        path.to_string_lossy().into_owned()
    })
    .clone()
}

/// Benchmark clip: 4 s, 24 fps, 4K 10-bit HEVC at about 20 Mbps (gradients plus noise with fixed
/// colours and seeds, nothing copyrighted), generated once per detection with ffmpeg and kept in a
/// playarr-owned directory.
const BENCH_CLIP_NAME: &str = "bench-4k-20m-v2.mp4";
const BENCH_FRAMES: u32 = 96;

/// The node's tone-mapping inputs: binaries, threads and the directory the benchmark clip lives in.
#[derive(Clone)]
struct DetectEnv {
    ffmpeg: String,
    ffprobe: String,
    threads: usize,
    bench_dir: PathBuf,
}

/// Probes the filters, then (when a Vulkan device initialises) generates the benchmark clip once and
/// runs the node's own transcode chain, the one a profile 5 title would use (decode 4K HEVC, scale to
/// 1080p, libplacebo, x264 at the 1080p profile bitrate, `threads` for everything including
/// lavapipe), over it. The RPU path is offered only at [`video::RPU_MIN_FPS`] or better.
async fn detect_tone_map_support(
    env: &DetectEnv,
    on_filters: impl FnOnce(video::FilterProbe),
) -> video::ToneMapSupport {
    let probe = video::probe_filters(&env.ffmpeg).await;
    on_filters(probe);
    let mut fps = None;
    if probe.vulkan {
        if let Some(clip) = bench_clip(env).await {
            // The first run pays for shader compilation and cold caches: take the better of two.
            let first = benchmark_rpu_chain(env, &clip).await;
            let second = benchmark_rpu_chain(env, &clip).await;
            fps = first.max(second);
        }
    }
    video::ToneMapSupport {
        zscale: probe.zscale,
        libplacebo: fps.is_some_and(|f| f >= video::RPU_MIN_FPS),
        libplacebo_fps: fps,
    }
}

/// True when `path` is the benchmark clip: [`BENCH_FRAMES`] frames of 3840x2160.
async fn bench_clip_valid(env: &DetectEnv, path: &Path) -> bool {
    let Ok(out) = tokio::time::timeout(
        Duration::from_secs(20),
        Command::new(&env.ffprobe)
            .args([
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-count_frames",
                "-show_entries",
                "stream=width,height,nb_read_frames",
                "-of",
                "csv=p=0",
            ])
            .arg(path)
            .kill_on_drop(true)
            .output(),
    )
    .await
    else {
        return false;
    };
    out.is_ok_and(|o| {
        o.status.success()
            && String::from_utf8_lossy(&o.stdout).trim() == format!("3840,2160,{BENCH_FRAMES}")
    })
}

/// Generates the clip into a uuid-named partial file that is always removed unless renamed into place.
async fn generate_bench_clip(env: &DetectEnv, path: &Path) -> bool {
    let partial = path.with_extension(format!("{}.part.mp4", Uuid::new_v4()));
    let x265 = format!(
        "pools={}:frame-threads=1:preset=veryfast:bitrate=20000:vbv-maxrate=24000:vbv-bufsize=24000:colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc:log-level=error",
        env.threads
    );
    // Colours and seeds are explicit so every node builds the same clip.
    let source = "gradients=s=3840x2160:d=4:r=24:speed=0.05:nb_colors=5:seed=3:c0=0x203060:c1=0xd08040:c2=0x40a060:c3=0xa03070:c4=0x808080,noise=alls=40:allf=t+u:all_seed=1,format=yuv420p10le";
    let ran = tokio::time::timeout(
        Duration::from_secs(180),
        Command::new(&env.ffmpeg)
            .args(["-hide_banner", "-loglevel", "error", "-y", "-threads"])
            .arg(env.threads.to_string())
            .args([
                "-f",
                "lavfi",
                "-i",
                source,
                "-c:v",
                "libx265",
                "-x265-params",
            ])
            .arg(&x265)
            .args(["-tag:v", "hvc1", "-an"])
            .arg(&partial)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .status(),
    )
    .await;
    let ok = matches!(ran, Ok(Ok(status)) if status.success())
        && bench_clip_valid(env, &partial).await
        && tokio::fs::rename(&partial, path).await.is_ok();
    // Every exit path, a timeout included, leaves no partial file behind.
    let _ = tokio::fs::remove_file(&partial).await;
    ok
}

/// The verified benchmark clip, generated first when missing or damaged. Called once per detection.
async fn bench_clip(env: &DetectEnv) -> Option<PathBuf> {
    tokio::fs::create_dir_all(&env.bench_dir).await.ok()?;
    let path = env.bench_dir.join(BENCH_CLIP_NAME);
    if tokio::fs::metadata(&path).await.is_ok() {
        if bench_clip_valid(env, &path).await {
            return Some(path);
        }
        let _ = tokio::fs::remove_file(&path).await;
    }
    generate_bench_clip(env, &path).await.then_some(path)
}

async fn benchmark_rpu_chain(env: &DetectEnv, input: &Path) -> Option<u32> {
    let (binary, threads) = (&env.ffmpeg, env.threads);
    let dir = env.bench_dir.join(format!("run-{}", Uuid::new_v4()));
    tokio::fs::create_dir_all(&dir).await.ok()?;
    let result = async {
        let out = dir.join("out");
        tokio::fs::create_dir_all(&out).await.ok()?;
        // The clip stands in for a profile 5 title: the same chain, libplacebo, is selected.
        let source = video::SourceVideo {
            codec: "hevc".into(),
            width: 3840,
            height: 2160,
            bit_depth: 10,
            dv_profile: Some(5),
            dv_bl_compat: Some(0),
            ..Default::default()
        };
        let args = build_hls_args(
            input,
            &TranscodeTargetProfile::resolve("h264-1080p-8mbps"),
            &out,
            0,
            None,
            None,
            None,
            threads,
            Some(&source),
            video::ToneMapSupport {
                zscale: true,
                libplacebo: true,
                libplacebo_fps: None,
            },
            StreamHints::default(),
        )
        .ok()?;
        let started = std::time::Instant::now();
        let ran = tokio::time::timeout(
            Duration::from_secs(60),
            Command::new(binary)
                .args(&args)
                .env("LP_NUM_THREADS", threads.to_string())
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .kill_on_drop(true)
                .status(),
        )
        .await
        .ok()?
        .ok()?;
        ran.success()
            .then(|| (f64::from(BENCH_FRAMES) / started.elapsed().as_secs_f64()).round() as u32)
    }
    .await;
    let _ = tokio::fs::remove_dir_all(&dir).await;
    result
}

/// Decides, per playback request, whether the source file can be served
/// as-is, whether an existing rendition covers it, or whether a new
/// on-demand transcode needs to be started — and owns starting that
/// transcode when it does.
pub struct TranscodeOrchestrator {
    rendition_repo: Arc<dyn RenditionRepo>,
    /// Backs [`TranscodeSession`] lifecycle (create/lookup/expire) — see
    /// the module docs for why sessions live here rather than in
    /// `playarr-db`.
    cache: Arc<dyn CacheAndPubSub>,
    active_sessions: ActiveSessionCounter,
    /// ffmpeg executable: a bare name resolved on `PATH` by default, or an
    /// absolute path. Overridable via [`Self::with_ffmpeg_binary`] so
    /// tests can point this at a harmless stand-in instead of a real
    /// ffmpeg install.
    ffmpeg_binary: String,
    /// Parent directory for per-session output; each session gets its own
    /// `output_root/<session-id>/` subdirectory.
    output_root: PathBuf,
    session_ttl: Duration,
    /// Node-local atomic admission for on-demand FFmpeg jobs; independent
    /// from a user's `Policy::max_concurrent_sessions`.
    transcode_slots: Arc<Semaphore>,
    /// Total admission permits (slots x [`PERMITS_PER_SLOT`]).
    total_permits: usize,
    /// The running download, if any, so live playback can pause it.
    download: Arc<std::sync::Mutex<Option<Arc<DownloadShared>>>>,
    ffmpeg_threads: usize,
    /// Process handles for sessions this exact node spawned, so
    /// `expire_session` can actually terminate the ffmpeg process instead
    /// of only forgetting about it. Only ever contains sessions this
    /// instance itself spawned — a session owned by a different node (per
    /// `TranscodeSession::owning_node_id`) has no entry here even after
    /// this node's `lookup_session` finds it in the shared cache.
    ///
    /// TODO: expiring a session from a node that isn't its owner (e.g. an
    /// idle-sweep running on a different node in a multi-node deployment)
    /// currently only removes the cache row; it can't reach into the
    /// owning node's process table to kill the ffmpeg process. That needs
    /// a cross-node signal (e.g. a `CacheAndPubSub::publish` on a
    /// per-node control channel) once multi-node on-demand transcode is
    /// actually exercised — deferred, since today every node only ever
    /// expires sessions it owns.
    active_children: Mutex<HashMap<Uuid, ActiveChild>>,
    /// Links the durable/user-facing playback session id returned by the
    /// API to the ephemeral on-demand transcode process serving it. The
    /// ids are deliberately different domains: `PlaybackSession` is an
    /// analytics record, while `TranscodeSession` identifies an ffmpeg
    /// process and its HLS output directory.
    ///
    /// Keeping the association here lets a normal playback Stop/Error
    /// event terminate the exact process immediately. Re-associating the
    /// same playback session (for example after a quality change or a
    /// duplicate negotiation) expires the superseded process instead of
    /// leaving it running until its idle TTL.
    playback_transcodes: Mutex<HashMap<Uuid, Uuid>>,
    /// Running transcodes another playback session may attach to. The
    /// reference count is the number of `playback_transcodes` entries that
    /// point at a transcode; the process stops when the last one leaves.
    shared_transcodes: Mutex<HashMap<SharedTranscodeKey, Uuid>>,
    /// One lock per key while a first request finds, spawns and registers, so racing requests attach instead of
    /// each spawning. See [`Self::share_guard`].
    inflight: Mutex<HashMap<SharedTranscodeKey, Arc<Mutex<()>>>>,
    /// Viewers whose running transcode was just stopped by their own stop event (clients stop the old session
    /// before renegotiating a seek or switch): they still count as admitted for [`ADMISSION_GRACE`].
    recently_released: std::sync::Mutex<HashMap<(Uuid, Uuid, Uuid), std::time::Instant>>,
    /// See the module docs' "other bridge" section and
    /// [`Self::with_tdarr_notify`]. `None` (the default) means "don't
    /// notify Tdarr" — correct both when Tdarr isn't configured for this
    /// deployment and when this node doesn't also run the worker role.
    tdarr_notify: Option<mpsc::Sender<MediaFileImportEvent>>,
    /// Which tone-mapping filters this ffmpeg runs and whether the RPU path is fast enough; see
    /// [`Self::tone_map_support`].
    detect: Arc<std::sync::Mutex<DetectState>>,
    /// ffprobe executable used for source probes.
    ffprobe_binary: String,
    /// How many times detection has started (tests).
    detect_runs: Arc<AtomicUsize>,
    /// Source probes by (media file, size), so negotiation and the spawn probe a file once.
    source_probes: std::sync::Mutex<video::ProbeCache>,
}

#[derive(Default)]
struct DetectState {
    done: Option<(video::ToneMapSupport, std::time::Instant)>,
    /// The filter listing, stored as soon as it is known (before the slower benchmark).
    filters: Option<video::FilterProbe>,
    running: Option<tokio::sync::watch::Receiver<Option<video::ToneMapSupport>>>,
}

/// A detection that found no usable RPU path is repeated after this long (a GPU driver that came up
/// late, a transient failure); a positive result is kept.
const DETECT_RETRY_TTL: Duration = Duration::from_secs(300);

struct ActiveChild {
    child: Child,
    // Holds the admission slot for the lifetime of the tracked process.
    // Completed children remain tracked until session TTL cleanup so their
    // generated HLS output remains available to existing playback sessions.
    slot: Option<Slot>,
}

impl TranscodeOrchestrator {
    pub fn new(
        rendition_repo: Arc<dyn RenditionRepo>,
        cache: Arc<dyn CacheAndPubSub>,
        active_sessions: ActiveSessionCounter,
    ) -> Self {
        Self {
            rendition_repo,
            cache,
            active_sessions,
            ffmpeg_binary: "ffmpeg".to_string(),
            output_root: std::env::temp_dir().join("playarr-transcode"),
            session_ttl: Duration::from_secs(60),
            transcode_slots: Arc::new(Semaphore::new(PERMITS_PER_SLOT as usize)),
            total_permits: PERMITS_PER_SLOT as usize,
            download: Arc::new(std::sync::Mutex::new(None)),
            ffmpeg_threads: DEFAULT_FFMPEG_THREADS,
            active_children: Mutex::new(HashMap::new()),
            playback_transcodes: Mutex::new(HashMap::new()),
            shared_transcodes: Mutex::new(HashMap::new()),
            inflight: Mutex::new(HashMap::new()),
            recently_released: std::sync::Mutex::new(HashMap::new()),
            tdarr_notify: None,
            ffprobe_binary: default_ffprobe_binary(),
            detect: Arc::new(std::sync::Mutex::new(DetectState::default())),
            detect_runs: Arc::new(AtomicUsize::new(0)),
            source_probes: std::sync::Mutex::new(video::ProbeCache::default()),
        }
    }

    /// ffprobe executable for source probes (defaults to `PLAYARR_FFPROBE_BINARY`, else `ffprobe`).
    pub fn with_ffprobe_binary(mut self, ffprobe_binary: impl Into<String>) -> Self {
        self.ffprobe_binary = ffprobe_binary.into();
        self
    }

    pub fn with_ffmpeg_binary(mut self, ffmpeg_binary: impl Into<String>) -> Self {
        self.ffmpeg_binary = ffmpeg_binary.into();
        self
    }

    /// Wires this orchestrator to notify [`TdarrDispatcher`] (via the same
    /// channel `TdarrDispatcher::new` takes a receiver for) every time it
    /// starts a live on-demand session — see the module docs' "other
    /// bridge" section for why. Skipped entirely (stays `None`) when Tdarr
    /// isn't configured for this deployment.
    pub fn with_tdarr_notify(mut self, tdarr_notify: mpsc::Sender<MediaFileImportEvent>) -> Self {
        self.tdarr_notify = Some(tdarr_notify);
        self
    }

    pub fn with_output_root(mut self, output_root: impl Into<PathBuf>) -> Self {
        self.output_root = output_root.into();
        self
    }

    pub fn with_session_ttl(mut self, session_ttl: Duration) -> Self {
        self.session_ttl = session_ttl;
        self
    }

    pub fn with_max_concurrent_sessions(mut self, max: usize) -> Self {
        let max = max.max(1);
        self.total_permits = max * PERMITS_PER_SLOT as usize;
        self.transcode_slots = Arc::new(Semaphore::new(self.total_permits));
        self
    }

    /// Sets the maximum number of threads FFmpeg may use per on-demand job.
    pub fn with_ffmpeg_threads(mut self, threads: usize) -> Self {
        self.ffmpeg_threads = threads.max(1);
        self
    }

    pub fn active_session_count(&self) -> usize {
        self.active_sessions.get()
    }

    /// Step 1: compares `media_file`'s container/codec/bitrate against
    /// `capabilities`. A pure function (no I/O) so it can be called
    /// synchronously on the playback request's hot path.
    ///
    /// `MediaFile` tracks a single `codec` field (the video codec — *arr
    /// apps report one primary encoding per file, not a separate audio
    /// codec), so this compares it against `supported_video_codecs`.
    /// Audio-codec compatibility can't be checked here without extending
    /// `playarr_model::MediaFile` with an audio-codec field, which is
    /// out of this crate's scope; `capabilities.supported_audio_codecs` is
    /// accepted but currently only informational for callers, not
    /// enforced by this check.
    pub fn can_direct_play(
        &self,
        media_file: &MediaFile,
        capabilities: &ClientCapabilities,
    ) -> bool {
        let container_ok = capabilities
            .supported_containers
            .iter()
            .any(|c| c.eq_ignore_ascii_case(&media_file.container));

        let codec_ok = capabilities
            .supported_video_codecs
            .iter()
            .chain(capabilities.supported_audio_codecs.iter())
            .any(|c| codecs_match(c, &media_file.codec));

        // An unknown source bitrate (the source *arr instance didn't
        // report one) or an uncapped client can't fail this check — only
        // a known bitrate that's known to exceed a known cap blocks
        // direct play.
        let bitrate_ok = match (media_file.bitrate, capabilities.max_bitrate_bps) {
            (Some(file_bitrate), Some(max_bitrate)) => file_bitrate <= max_bitrate,
            _ => true,
        };

        container_ok && codec_ok && bitrate_ok
    }

    /// Probes the first video stream of `media_file` once per (file, size); `None` when ffprobe fails.
    pub async fn probe_source(&self, media_file: &MediaFile) -> Option<video::SourceVideo> {
        let key = (media_file.id, media_file.size_bytes);
        if let Some(hit) = self
            .source_probes
            .lock()
            .ok()?
            .get(key, std::time::Instant::now())
        {
            return hit;
        }
        let path = playarr_model::resolve_media_path(&media_file.path);
        let probed = video::probe_source_video_with(&self.ffprobe_binary, &path, 8).await;
        if let Ok(mut cache) = self.source_probes.lock() {
            cache.put(key, probed.clone(), std::time::Instant::now());
        }
        probed
    }

    /// Starts the single-file MP4 transcode of a download ticket with the admission taken by
    /// [`Self::reserve_download`]. Errors with [`TranscodeError::UnsupportedColour`] for a title whose
    /// colours cannot be converted here (profile 5 without a fast enough libplacebo, or an unprobeable
    /// HEVC file). ffmpeg runs under `nice`.
    pub async fn start_download(
        &self,
        reservation: DownloadReservation,
        media_file: &MediaFile,
        profile: &str,
        output_path: &Path,
        tracks: &DownloadTracks,
    ) -> Result<DownloadJob, TranscodeError> {
        let mut probed = self.probe_source(media_file).await;
        if video::colour_unknown(&media_file.codec, probed.as_ref()) {
            probed = self.probe_source_strict(media_file).await;
        }
        if video::colour_unknown(&media_file.codec, probed.as_ref()) {
            return Err(TranscodeError::UnsupportedColour);
        }
        let source = probed.unwrap_or_default();
        let tone_map = if source.requires_rpu() {
            self.tone_map_support().await
        } else {
            self.tone_map_support_now()
        };
        let input = playarr_model::resolve_media_path(&media_file.path);
        let args = build_download_args(
            &input,
            &TranscodeTargetProfile::resolve(profile),
            output_path,
            self.ffmpeg_threads,
            &source,
            tone_map,
            tracks,
        )?;
        if let Some(parent) = output_path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        let spawn = |niced: bool| {
            let mut command = if niced {
                let mut c = Command::new("nice");
                c.args(["-n", "10"]).arg(&self.ffmpeg_binary);
                c
            } else {
                Command::new(&self.ffmpeg_binary)
            };
            command
                .args(&args)
                .env("LP_NUM_THREADS", self.ffmpeg_threads.to_string())
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .kill_on_drop(true)
                .spawn()
        };
        // `nice` execs ffmpeg in place, so the pid is ffmpeg's; without `nice` it runs unniced.
        let child = match spawn(true) {
            Ok(child) => child,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => spawn(false)?,
            Err(error) => return Err(error.into()),
        };
        let shared = reservation.into_shared();
        let pid = child.id().unwrap_or(0);
        shared.pid.store(pid, Ordering::SeqCst);
        // Live playback took the slot while the download was being set up: start it stopped.
        if shared.paused.load(Ordering::SeqCst) {
            signal(pid, libc::SIGSTOP);
        }
        Ok(DownloadJob {
            child,
            handle: DownloadHandle {
                shared,
                slots: self.transcode_slots.clone(),
                total_permits: self.total_permits,
            },
            registry: self.download.clone(),
        })
    }

    /// Strict probe for a source whose colour format must be known: the cached answer when it is a
    /// success, otherwise a fresh probe with a longer limit. `None` means the colours stay unknown.
    pub async fn probe_source_strict(&self, media_file: &MediaFile) -> Option<video::SourceVideo> {
        let key = (media_file.id, media_file.size_bytes);
        if let Some(Some(hit)) = self
            .source_probes
            .lock()
            .ok()?
            .get(key, std::time::Instant::now())
        {
            return Some(hit);
        }
        let path = playarr_model::resolve_media_path(&media_file.path);
        let probed = video::probe_source_video_with(&self.ffprobe_binary, &path, 30).await;
        if let Ok(mut cache) = self.source_probes.lock() {
            cache.put(key, probed.clone(), std::time::Instant::now());
        }
        probed
    }

    /// Which tone-mapping filters this node's ffmpeg runs, and whether it can apply a Dolby Vision RPU
    /// live (libplacebo on a Vulkan device whose measured speed on the node's real transcode chain
    /// reaches [`video::RPU_MIN_FPS`]). Detected once in a spawned task, so a dropped caller never
    /// cancels it or starts a second run; a negative RPU result is re-run after [`DETECT_RETRY_TTL`].
    pub async fn tone_map_support(&self) -> video::ToneMapSupport {
        let mut rx = {
            let mut state = self.detect.lock().expect("detect state");
            let stale = match state.done {
                Some((support, at)) if support.libplacebo || at.elapsed() < DETECT_RETRY_TTL => {
                    return support;
                }
                other => other.map(|(support, _)| support),
            };
            let rx = match &state.running {
                Some(rx) => rx.clone(),
                None => {
                    let (tx, rx) = tokio::sync::watch::channel(None);
                    state.running = Some(rx.clone());
                    self.detect_runs.fetch_add(1, Ordering::SeqCst);
                    let env = DetectEnv {
                        ffmpeg: self.ffmpeg_binary.clone(),
                        ffprobe: self.ffprobe_binary.clone(),
                        threads: self.ffmpeg_threads,
                        bench_dir: self.output_root.join("bench"),
                    };
                    let shared = self.detect.clone();
                    tokio::spawn(async move {
                        // Clears `running` even if detection panics, so the next call retries.
                        struct Running(Arc<std::sync::Mutex<DetectState>>);
                        impl Drop for Running {
                            fn drop(&mut self) {
                                if let Ok(mut state) = self.0.lock() {
                                    state.running = None;
                                }
                            }
                        }
                        let _running = Running(shared.clone());
                        let support = detect_tone_map_support(&env, |probe| {
                            if let Ok(mut state) = shared.lock() {
                                state.filters = Some(probe);
                            }
                        })
                        .await;
                        tracing::info!(?support, "tone-mapping support detected");
                        if let Ok(mut state) = shared.lock() {
                            state.done = Some((support, std::time::Instant::now()));
                        }
                        let _ = tx.send(Some(support));
                    });
                    rx
                }
            };
            // An old negative answer is served while a refresh runs; only the first detection waits.
            if let Some(stale) = stale {
                return stale;
            }
            rx
        };
        loop {
            if let Some(support) = *rx.borrow() {
                return support;
            }
            if rx.changed().await.is_err() {
                return video::ToneMapSupport {
                    zscale: false,
                    libplacebo: false,
                    libplacebo_fps: None,
                };
            }
        }
    }

    /// Tone-mapping support without waiting: the settled answer, else plain zscale (no RPU path). Only
    /// a profile 5 source needs the real answer; everything else must not wait for detection.
    pub fn tone_map_support_now(&self) -> video::ToneMapSupport {
        let Ok(state) = self.detect.lock() else {
            return video::ToneMapSupport::default();
        };
        if let Some((support, _)) = state.done {
            return support;
        }
        // Mid-detection: the filter listing is known long before the benchmark ends.
        state
            .filters
            .map_or_else(video::ToneMapSupport::default, |f| video::ToneMapSupport {
                zscale: f.zscale,
                libplacebo: false,
                libplacebo_fps: None,
            })
    }

    /// Step 2: looks up whether a `Ready` rendition already exists for
    /// this `(media_file_id, profile)` pair — via
    /// `RenditionRepo::find_ready` — regardless of whether the background
    /// Tdarr pipeline or a previous on-demand session produced it.
    pub async fn find_existing_rendition(
        &self,
        media_file_id: Uuid,
        profile: &str,
    ) -> Result<Option<Rendition>, TranscodeError> {
        let rendition = self
            .rendition_repo
            .find_ready(media_file_id, profile)
            .await?;
        // On-demand encodes made before HDR tone mapping existed carry untouched HDR pictures
        // (washed out or green); they are re-made instead of reused.
        Ok(rendition.filter(|r| {
            r.produced_by != playarr_model::ProducedBy::OnDemand || r.produced_at >= *TONE_MAP_EPOCH
        }))
    }

    /// Step 3, last resort: starts a new [`TranscodeSession`] on
    /// `owning_node_id`. Returns once the ffmpeg process has been spawned
    /// (not once the whole transcode completes) and the session is
    /// recorded in the cache. Errors with `TranscodeError::NoCapacity`
    /// when this node has no spare on-demand worker slot per
    /// `with_max_concurrent_sessions` (policy for what happens next —
    /// queue, reject, route to another node — is the caller's, informed by
    /// `playarr_model::Policy::can_transcode` and node load).
    pub async fn spawn_on_demand_transcode(
        &self,
        media_file: &MediaFile,
        profile: &str,
        owning_node_id: &str,
    ) -> Result<TranscodeSession, TranscodeError> {
        self.spawn_on_demand_transcode_at(media_file, profile, owning_node_id, 0)
            .await
    }

    /// Starts a short-lived HLS transcode at an absolute source timestamp.
    /// Used when a player seeks beyond the currently-produced live
    /// playlist: the old process is stopped by its playback session, and a
    /// replacement process begins encoding from this source position.
    pub async fn spawn_on_demand_transcode_at(
        &self,
        media_file: &MediaFile,
        profile: &str,
        owning_node_id: &str,
        start_position_ms: u64,
    ) -> Result<TranscodeSession, TranscodeError> {
        self.spawn_on_demand_transcode_at_with_audio(
            media_file,
            profile,
            owning_node_id,
            start_position_ms,
            None,
            StreamHints::default(),
        )
        .await
    }

    pub async fn spawn_on_demand_transcode_at_with_audio(
        &self,
        media_file: &MediaFile,
        profile: &str,
        owning_node_id: &str,
        start_position_ms: u64,
        audio_stream_index: Option<u32>,
        hints: StreamHints,
    ) -> Result<TranscodeSession, TranscodeError> {
        let slot = self.reserve_capacity(FULL_TRANSCODE_PERMITS).await?;
        self.spawn_on_demand(
            Uuid::new_v4(),
            media_file,
            profile,
            owning_node_id,
            start_position_ms,
            audio_stream_index,
            None,
            None,
            hints,
            slot,
        )
        .await
    }

    /// Like [`Self::spawn_on_demand_transcode_at_with_audio`], but the source
    /// video is copied instead of re-encoded (see [`VideoCopy`]).
    #[allow(clippy::too_many_arguments)]
    pub async fn spawn_video_copy_at_with_audio(
        &self,
        media_file: &MediaFile,
        profile: &str,
        owning_node_id: &str,
        start_position_ms: u64,
        audio_stream_index: Option<u32>,
        video: VideoCopy,
        hints: StreamHints,
    ) -> Result<TranscodeSession, TranscodeError> {
        let slot = self.reserve_capacity(VIDEO_COPY_PERMITS).await?;
        self.spawn_on_demand(
            Uuid::new_v4(),
            media_file,
            profile,
            owning_node_id,
            start_position_ms,
            audio_stream_index,
            None,
            Some(video),
            hints,
            slot,
        )
        .await
    }

    /// Starts an on-demand HLS transcode whose audio is an external file
    /// (a Dubarr dub track) instead of a source-container stream.
    ///
    /// `fetch` is handed a local path inside this orchestrator's scratch area
    /// and must write the complete audio file there (Playarr downloads it
    /// itself, so credentials stay inside this process and never reach
    /// ffmpeg's argument list). The file is deleted with the session. If the
    /// fetch fails nothing is spawned and [`TranscodeError::ExternalAudio`]
    /// is returned so the caller can fall back to the source audio.
    pub async fn spawn_on_demand_transcode_with_fetched_audio<F, Fut>(
        &self,
        media_file: &MediaFile,
        profile: &str,
        owning_node_id: &str,
        start_position_ms: u64,
        hints: StreamHints,
        fetch: F,
    ) -> Result<TranscodeSession, TranscodeError>
    where
        F: FnOnce(PathBuf) -> Fut,
        Fut: std::future::Future<Output = Result<(), String>>,
    {
        self.spawn_with_fetched_audio(
            media_file,
            profile,
            owning_node_id,
            start_position_ms,
            None,
            hints,
            fetch,
        )
        .await
    }

    /// [`Self::spawn_on_demand_transcode_with_fetched_audio`] with the source
    /// video copied instead of re-encoded (see [`VideoCopy`]).
    #[allow(clippy::too_many_arguments)]
    pub async fn spawn_video_copy_with_fetched_audio<F, Fut>(
        &self,
        media_file: &MediaFile,
        profile: &str,
        owning_node_id: &str,
        start_position_ms: u64,
        video: VideoCopy,
        hints: StreamHints,
        fetch: F,
    ) -> Result<TranscodeSession, TranscodeError>
    where
        F: FnOnce(PathBuf) -> Fut,
        Fut: std::future::Future<Output = Result<(), String>>,
    {
        self.spawn_with_fetched_audio(
            media_file,
            profile,
            owning_node_id,
            start_position_ms,
            Some(video),
            hints,
            fetch,
        )
        .await
    }

    #[allow(clippy::too_many_arguments)]
    async fn spawn_with_fetched_audio<F, Fut>(
        &self,
        media_file: &MediaFile,
        profile: &str,
        owning_node_id: &str,
        start_position_ms: u64,
        video_copy: Option<VideoCopy>,
        hints: StreamHints,
        fetch: F,
    ) -> Result<TranscodeSession, TranscodeError>
    where
        F: FnOnce(PathBuf) -> Fut,
        Fut: std::future::Future<Output = Result<(), String>>,
    {
        let slot = self
            .reserve_capacity(if video_copy.is_some() {
                VIDEO_COPY_PERMITS
            } else {
                FULL_TRANSCODE_PERMITS
            })
            .await?;
        let session_id = Uuid::new_v4();
        let path = self.external_audio_path(session_id);
        tokio::fs::create_dir_all(&self.output_root).await?;
        if let Err(message) = fetch(path.clone()).await {
            let _ = tokio::fs::remove_file(&path).await;
            return Err(TranscodeError::ExternalAudio(message));
        }
        let external = ExternalAudio { path: path.clone() };
        let result = self
            .spawn_on_demand(
                session_id,
                media_file,
                profile,
                owning_node_id,
                start_position_ms,
                None,
                Some(&external),
                video_copy,
                hints,
                slot,
            )
            .await;
        if result.is_err() {
            let _ = tokio::fs::remove_file(&path).await;
        }
        result
    }

    /// Where a session's fetched external audio lives. A sibling of the HLS
    /// output directory, never inside it, so the session file route can
    /// never serve it.
    fn external_audio_path(&self, session_id: Uuid) -> PathBuf {
        self.output_root
            .join(format!("{session_id}.external-audio"))
    }

    async fn reserve_capacity(&self, permits: u32) -> Result<Slot, TranscodeError> {
        // Release permits for children that exited naturally before trying
        // the non-blocking admission check.
        self.reap_finished_children().await;
        if let Ok(permit) = self.transcode_slots.clone().try_acquire_many_owned(permits) {
            return Ok(Slot {
                permit: Some(permit),
            });
        }
        if BORROW_ADMISSION.try_with(|borrow| *borrow).unwrap_or(false) {
            return Ok(Slot { permit: None });
        }
        // Live playback always wins: a running download yields its slot (it is paused, not killed).
        if self.preempt_download().await {
            if let Ok(permit) = self.transcode_slots.clone().try_acquire_many_owned(permits) {
                return Ok(Slot {
                    permit: Some(permit),
                });
            }
        }
        Err(TranscodeError::NoCapacity)
    }

    /// Pauses the running (or still starting) download and releases its permits; `true` when it gave a
    /// slot up. A refused SIGSTOP means the download keeps its slot and live playback is not served.
    async fn preempt_download(&self) -> bool {
        let shared = self.download.lock().ok().and_then(|d| d.clone());
        let Some(shared) = shared else {
            return false;
        };
        if shared.paused.swap(true, Ordering::SeqCst) {
            return false;
        }
        let pid = shared.pid.load(Ordering::SeqCst);
        // pid 0: ffmpeg has not started yet; it is stopped as soon as it does.
        if pid != 0 && !signal(pid, libc::SIGSTOP) {
            shared.paused.store(false, Ordering::SeqCst);
            return false;
        }
        let permit = shared.permit.lock().ok().and_then(|mut held| held.take());
        tracing::info!("download paused for live playback");
        permit.is_some()
    }

    /// Admission for a download: only when live playback keeps a spare slot (a one-slot node must be
    /// completely idle) and no other download runs. Taken before the ticket is claimed.
    pub fn reserve_download(&self) -> Result<DownloadReservation, TranscodeError> {
        let mut registry = self
            .download
            .lock()
            .map_err(|_| TranscodeError::NoCapacity)?;
        if registry.is_some()
            || self.transcode_slots.available_permits()
                < download_admission_need(self.total_permits)
        {
            return Err(TranscodeError::NoCapacity);
        }
        let permit = self
            .transcode_slots
            .clone()
            .try_acquire_many_owned(FULL_TRANSCODE_PERMITS)
            .map_err(|_| TranscodeError::NoCapacity)?;
        let shared = Arc::new(DownloadShared {
            pid: std::sync::atomic::AtomicU32::new(0),
            permit: std::sync::Mutex::new(Some(permit)),
            paused: std::sync::atomic::AtomicBool::new(false),
        });
        *registry = Some(shared.clone());
        Ok(DownloadReservation {
            shared: Some(shared),
            registry: self.download.clone(),
        })
    }

    #[allow(clippy::too_many_arguments)]
    async fn spawn_on_demand(
        &self,
        session_id: Uuid,
        media_file: &MediaFile,
        profile: &str,
        owning_node_id: &str,
        start_position_ms: u64,
        audio_stream_index: Option<u32>,
        external: Option<&ExternalAudio>,
        video_copy: Option<VideoCopy>,
        hints: StreamHints,
        slot: Slot,
    ) -> Result<TranscodeSession, TranscodeError> {
        let target_profile = TranscodeTargetProfile::resolve(profile);
        let output_dir = self.output_root.join(session_id.to_string());
        tokio::fs::create_dir_all(&output_dir).await?;

        let source_path = playarr_model::resolve_media_path(&media_file.path);
        // A failed probe still gets the SDR path (range + BT.709 tags) rather than the bare encode.
        let mut probed = self.probe_source(media_file).await;
        if video::colour_unknown(&media_file.codec, probed.as_ref()) {
            probed = self.probe_source_strict(media_file).await;
        }
        // Colours still unknown for an HEVC source: never encode or copy blind.
        if video::colour_unknown(&media_file.codec, probed.as_ref()) {
            return Err(TranscodeError::UnsupportedColour);
        }
        let source_video = match video_copy {
            // A copy keeps the picture, but a profile 5 copy is still guarded in `build_hls_args`.
            Some(_) => probed,
            None => Some(probed.unwrap_or_default()),
        };
        let tone_map = if source_video.as_ref().is_some_and(|s| s.requires_rpu()) {
            self.tone_map_support().await
        } else {
            self.tone_map_support_now()
        };
        let args = build_hls_args(
            &source_path,
            &target_profile,
            &output_dir,
            start_position_ms,
            audio_stream_index,
            external,
            video_copy,
            self.ffmpeg_threads,
            source_video.as_ref(),
            tone_map,
            hints,
        )?;

        let mut command = Command::new(&self.ffmpeg_binary);
        command
            .args(&args)
            // lavapipe (CPU Vulkan, when there is no GPU) takes its thread count from here.
            .env("LP_NUM_THREADS", self.ffmpeg_threads.to_string())
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            // Don't let a spawned ffmpeg outlive this process (e.g. on a
            // panic unwind) with nothing left to ever expire its session.
            .kill_on_drop(true);

        let child = command.spawn()?;

        let now = Utc::now();
        let session = TranscodeSession {
            id: session_id,
            media_file_id: media_file.id,
            profile: profile.to_string(),
            owning_node_id: owning_node_id.to_string(),
            current_segment: 0,
            expires_at: now
                + chrono::Duration::from_std(self.session_ttl).unwrap_or(chrono::Duration::zero()),
        };

        if let Err(err) = self.store_session(&session).await {
            // We already spawned a real process — don't leak it if we
            // can't record the session anywhere lookups will find it.
            let mut child = child;
            let _ = child.kill().await;
            return Err(err);
        }

        self.active_children.lock().await.insert(
            session.id,
            ActiveChild {
                child,
                slot: Some(slot),
            },
        );
        self.active_sessions.increment();

        // Someone is watching this file right now via this temporary,
        // TTL'd session -- tell Tdarr to go produce a durable `Rendition`
        // for it in the background too, so a *future* request for the same
        // file+profile hits the `find_existing_rendition` cache hit instead
        // of paying for another on-demand transcode. `try_send`, never
        // awaited: a full/closed channel (Tdarr not configured, or this
        // node doesn't also run the worker role) must never affect
        // playback itself -- see the module docs' "other bridge" section.
        if let Some(tdarr_notify) = &self.tdarr_notify {
            let _ = tdarr_notify.try_send(MediaFileImportEvent {
                media_file: media_file.clone(),
            });
        }

        Ok(session)
    }

    /// Looks up a [`TranscodeSession`] by id, regardless of which node
    /// owns it — the cache entry is visible cluster-wide even though only
    /// the owning node has the actual ffmpeg process.
    /// The on-disk directory a live on-demand session's ffmpeg process
    /// writes its HLS playlist/segments into -- `playarr-api`'s media-
    /// serving routes use this to find the actual files a client's
    /// `playlist.m3u8`/segment requests resolve to. Same derivation
    /// `spawn_on_demand_transcode` already uses internally, exposed here
    /// rather than duplicated at the call site.
    pub fn session_output_dir(&self, session_id: Uuid) -> PathBuf {
        self.output_root.join(session_id.to_string())
    }

    /// Looks up a persisted [`Rendition`] by id -- `playarr-api`'s media-
    /// serving routes use this to resolve a `renditions/{id}/...` request
    /// to the on-disk directory `Rendition::output_path` points at.
    /// Delegates to the same `RenditionRepo` `find_existing_rendition`
    /// already wraps, rather than exposing that repo directly on
    /// `AppState` as a second, parallel path to the same data.
    pub async fn get_rendition(&self, id: Uuid) -> Result<Rendition, TranscodeError> {
        Ok(self.rendition_repo.get(id).await?)
    }

    /// Looks up a live [`TranscodeSession`] by id -- and, if found, slides
    /// its expiry forward by another full `session_ttl` from now.
    ///
    /// `session_ttl` is deliberately an *idle* deadline (see
    /// [`TranscodeSession::expires_at`]'s doc comment), not a hard cap on
    /// total session lifetime -- but until this method existed, nothing
    /// ever re-touched a session's cache entry after `spawn_on_demand_transcode`
    /// created it once, so every session (even one being actively watched
    /// straight through) silently expired exactly `session_ttl` after
    /// creation. Confirmed live: a real on-demand transcode played its
    /// first few segments successfully, then started 404ing mid-playback
    /// once the fixed 60s window elapsed -- indistinguishable from "can't
    /// play anything" for any title longer than a minute. `playarr-api`'s
    /// `serve_session_file_handler` (manifest + every segment request) is
    /// the only caller, and gets called continuously by a real player for
    /// the entire time it's actively watching -- exactly the activity this
    /// needs to key off of, so no separate heartbeat/keepalive endpoint is
    /// needed. An abandoned session (client stopped requesting: tab closed,
    /// navigated away, network dropped) still naturally expires and frees
    /// its capacity slot roughly `session_ttl` after the last real request.
    pub async fn lookup_session(
        &self,
        session_id: Uuid,
    ) -> Result<Option<TranscodeSession>, TranscodeError> {
        let key = Self::session_cache_key(session_id);
        let Some(bytes) = self.cache.get(&key).await? else {
            return Ok(None);
        };
        let mut session: TranscodeSession = serde_json::from_slice(&bytes)?;
        session.expires_at = Utc::now()
            + chrono::Duration::from_std(self.session_ttl).unwrap_or(chrono::Duration::zero());
        self.store_session(&session).await?;
        Ok(Some(session))
    }

    /// Ends a [`TranscodeSession`]: removes it from the cache (so no
    /// further lookups find it) and, if this node owns the underlying
    /// process, kills it and releases its capacity slot.
    pub async fn expire_session(&self, session_id: Uuid) -> Result<(), TranscodeError> {
        if let Some(mut active) = self.active_children.lock().await.remove(&session_id) {
            // The process may have already exited on its own (transcode
            // finished, or crashed) — `kill` erroring in that case is
            // expected, not a failure of expiry itself.
            if let Some(slot) = active.slot.take() {
                let _ = active.child.kill().await;
                self.active_sessions.decrement();
                drop(slot);
            }
        }

        self.cache
            .delete(&Self::session_cache_key(session_id))
            .await?;

        self.playback_transcodes
            .lock()
            .await
            .retain(|_, transcode_session_id| *transcode_session_id != session_id);
        self.shared_transcodes
            .lock()
            .await
            .retain(|_, transcode_session_id| *transcode_session_id != session_id);

        // HLS output is session-scoped and has no value once the process is
        // stopped. Ignore a missing directory (the process may have failed
        // before writing anything) but surface real filesystem errors.
        match tokio::fs::remove_file(self.external_audio_path(session_id)).await {
            Ok(()) => {}
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
            Err(err) => return Err(TranscodeError::Io(err)),
        }
        match tokio::fs::remove_dir_all(self.session_output_dir(session_id)).await {
            Ok(()) => {}
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
            Err(err) => return Err(TranscodeError::Io(err)),
        }

        Ok(())
    }

    /// Stops every ffmpeg process this node spawned whose session has aged
    /// out of the cache (no client requested the playlist or a segment for
    /// a full `session_ttl`: tab closed, network dropped, or the player
    /// replaced the session without sending a stop). Without this the cache
    /// row vanished but the process kept encoding, competing for CPU.
    /// Returns how many sessions were reaped.
    pub async fn reap_idle_sessions(&self) -> usize {
        self.reap_finished_children().await;
        let ids: Vec<Uuid> = self.active_children.lock().await.keys().copied().collect();
        let mut reaped = 0;
        for id in ids {
            let alive = match self.cache.get(&Self::session_cache_key(id)).await {
                Ok(entry) => entry.is_some(),
                // Cannot tell: leave the process alone this round.
                Err(_) => true,
            };
            if alive {
                continue;
            }
            match self.expire_session(id).await {
                Ok(()) => reaped += 1,
                Err(error) => {
                    tracing::warn!(session_id = %id, %error, "failed to reap idle transcode session")
                }
            }
        }
        reaped
    }

    /// Drops children that completed naturally, releasing their admission
    /// permits and active-process count. Called by the periodic reaper and
    /// before each new admission attempt.
    async fn reap_finished_children(&self) {
        let mut active = self.active_children.lock().await;
        for process in active.values_mut() {
            if process.slot.is_some() && matches!(process.child.try_wait(), Ok(Some(_))) {
                process.slot.take(); // release capacity, keep output/session tracked
                self.active_sessions.decrement();
            }
        }
    }

    /// Runs [`Self::reap_idle_sessions`] every `interval` until the task is
    /// dropped.
    pub async fn run_idle_reaper(self: Arc<Self>, interval: Duration) {
        let mut ticker = tokio::time::interval(interval);
        loop {
            ticker.tick().await;
            let reaped = self.reap_idle_sessions().await;
            if reaped > 0 {
                tracing::info!(reaped, "stopped idle on-demand transcode sessions");
            }
        }
    }

    /// Associates a user-facing playback session with its live ffmpeg
    /// session. If the playback session already pointed at another
    /// transcode (quality replacement or duplicate negotiation), the old
    /// process is stopped before this call returns, unless another playback
    /// session still shares it.
    pub async fn associate_playback_session(
        &self,
        playback_session_id: Uuid,
        transcode_session_id: Uuid,
    ) -> Result<(), TranscodeError> {
        let superseded = self
            .playback_transcodes
            .lock()
            .await
            .insert(playback_session_id, transcode_session_id);
        self.expire_if_unreferenced(superseded.filter(|id| *id != transcode_session_id))
            .await
    }

    /// Registers a freshly spawned transcode so later requests with the same
    /// key can attach to it.
    pub async fn register_shared_transcode(&self, key: SharedTranscodeKey, session_id: Uuid) {
        self.shared_transcodes.lock().await.insert(key, session_id);
    }

    /// Records that a viewer's running transcode was stopped by their own stop event.
    pub fn note_admitted_release(&self, user_id: Uuid, device_id: Uuid, media_file_id: Uuid) {
        let mut released = self.recently_released.lock().unwrap();
        let now = std::time::Instant::now();
        released.retain(|_, at| now.duration_since(*at) <= ADMISSION_GRACE);
        released.insert((user_id, device_id, media_file_id), now);
    }

    /// True once (and forgets the entry) if the viewer released a transcode within [`ADMISSION_GRACE`].
    pub fn take_admission_grace(
        &self,
        user_id: Uuid,
        device_id: Uuid,
        media_file_id: Uuid,
    ) -> bool {
        let mut released = self.recently_released.lock().unwrap();
        let now = std::time::Instant::now();
        released.retain(|_, at| now.duration_since(*at) <= ADMISSION_GRACE);
        released
            .remove(&(user_id, device_id, media_file_id))
            .is_some()
    }

    /// True while `playback_session_id` is linked to a running transcode: the viewer is admitted.
    pub async fn is_admitted(&self, playback_session_id: Uuid) -> bool {
        self.playback_transcodes
            .lock()
            .await
            .contains_key(&playback_session_id)
    }

    /// Serialises the find, spawn and register steps for one key, so racing first requests attach to the first
    /// one's transcode instead of each spawning their own. Hold the guard until the transcode is registered.
    pub async fn share_guard(&self, key: &SharedTranscodeKey) -> tokio::sync::OwnedMutexGuard<()> {
        let lock = {
            let mut inflight = self.inflight.lock().await;
            let lock = inflight.entry(key.clone()).or_default().clone();
            // Drop entries nobody holds or waits on (the map and this clone are the only references).
            inflight.retain(|other, lock| other == key || Arc::strong_count(lock) > 1);
            lock
        };
        lock.lock_owned().await
    }

    /// Finds a running transcode on this node that matches `key`, sliding
    /// its idle deadline. The caller links its playback session with
    /// [`Self::associate_playback_session`]. Costs no admission permit: the
    /// process already holds one.
    ///
    /// shortcut: if the last viewer of that transcode leaves between this
    /// call and the association, the new viewer gets a 404 playlist and the
    /// client's normal retry renegotiates; upgrade when that shows in logs.
    pub async fn find_shared_transcode(
        &self,
        key: &SharedTranscodeKey,
    ) -> Result<Option<TranscodeSession>, TranscodeError> {
        let Some(session_id) = self.shared_transcodes.lock().await.get(key).copied() else {
            return Ok(None);
        };
        let owned_here = self.active_children.lock().await.contains_key(&session_id);
        let session = if owned_here {
            self.lookup_session(session_id).await?
        } else {
            None
        };
        if session.is_none() {
            self.shared_transcodes.lock().await.remove(key);
        }
        Ok(session)
    }

    async fn expire_if_unreferenced(
        &self,
        transcode_session_id: Option<Uuid>,
    ) -> Result<(), TranscodeError> {
        let Some(id) = transcode_session_id else {
            return Ok(());
        };
        let still_used = self
            .playback_transcodes
            .lock()
            .await
            .values()
            .any(|linked| *linked == id);
        if still_used {
            return Ok(());
        }
        self.expire_session(id).await
    }

    /// Detaches a user-facing playback session from its on-demand
    /// transcode, stopping the process when no other playback session
    /// shares it. Direct-play and durable-rendition sessions have no
    /// association and are therefore harmless no-ops.
    pub async fn expire_playback_session(
        &self,
        playback_session_id: Uuid,
    ) -> Result<(), TranscodeError> {
        let transcode_session_id = self
            .playback_transcodes
            .lock()
            .await
            .remove(&playback_session_id);
        self.expire_if_unreferenced(transcode_session_id).await
    }

    fn session_cache_key(session_id: Uuid) -> String {
        format!("transcode-session:{session_id}")
    }

    async fn store_session(&self, session: &TranscodeSession) -> Result<(), TranscodeError> {
        let ttl = (session.expires_at - Utc::now())
            .to_std()
            .unwrap_or(Duration::ZERO);
        let bytes = serde_json::to_vec(session)?;
        self.cache
            .set(&Self::session_cache_key(session.id), bytes, Some(ttl))
            .await?;
        Ok(())
    }
}

/// A signal that a `MediaFile` was newly imported or upgraded — the
/// trigger for `TdarrDispatcher` to hand it to Tdarr via
/// `scan_individual_file`. There is no `MediaFileRepo` in `playarr-db`
/// yet for `TdarrDispatcher` to poll on its own, so dispatch is entirely
/// event-driven: whatever owns the import/upgrade event (an *arr webhook
/// handler, `playarr-arr-sync`'s reconciliation poller, etc. — outside
/// this crate) sends one of these on the channel `TdarrDispatcher::new`
/// takes a `Receiver` for.
#[derive(Debug, Clone)]
pub struct MediaFileImportEvent {
    pub media_file: MediaFile,
}

/// Static configuration for [`TdarrDispatcher`] — grouped into one struct
/// (rather than positional constructor args) since it's a handful of
/// deployment-specific knobs that are set once at startup, not values that
/// vary per call.
#[derive(Debug, Clone)]
pub struct TdarrDispatcherConfig {
    /// The Tdarr library database id `scan_individual_file` dispatches
    /// into. Playarr Server currently assumes one Tdarr library per
    /// deployment; if that stops being true this would need to become a
    /// per-`MediaFile` lookup instead of one fixed id.
    pub tdarr_db_id: String,
    /// The rendition profile checked via `RenditionRepo::find_ready`
    /// before dispatching — if a `Ready` rendition already exists for a
    /// `MediaFile` at this profile, there's nothing for Tdarr to do.
    pub default_profile: String,
    /// Which Tdarr worker pool `alter_worker_limit` throttles, e.g.
    /// `"transcodecpu"`.
    pub worker_process: String,
    /// Worker limit applied when the active on-demand session count is
    /// below `active_session_threshold`.
    pub default_worker_limit: i32,
    /// Worker limit applied at/above `active_session_threshold` —
    /// throttling background transcoding to leave CPU/GPU headroom for
    /// live on-demand playback.
    pub throttled_worker_limit: i32,
    pub active_session_threshold: usize,
    /// How often `TdarrDispatcher::run` re-checks session count and
    /// (re)applies the worker limit.
    pub throttle_check_interval: Duration,
}

/// The background path: proactively drives Tdarr to produce
/// [`Rendition`]s ahead of playback, so `TranscodeOrchestrator::find_existing_rendition`
/// has something to find instead of every session falling through to
/// on-demand. Runs as its own worker loop (role = `Worker`/`All`), separate
/// from the request-scoped `TranscodeOrchestrator`.
pub struct TdarrDispatcher {
    tdarr: TdarrClient,
    rendition_repo: Arc<dyn RenditionRepo>,
    active_sessions: ActiveSessionCounter,
    events_rx: mpsc::Receiver<MediaFileImportEvent>,
    config: TdarrDispatcherConfig,
}

impl TdarrDispatcher {
    pub fn new(
        tdarr: TdarrClient,
        rendition_repo: Arc<dyn RenditionRepo>,
        active_sessions: ActiveSessionCounter,
        events_rx: mpsc::Receiver<MediaFileImportEvent>,
        config: TdarrDispatcherConfig,
    ) -> Self {
        Self {
            tdarr,
            rendition_repo,
            active_sessions,
            events_rx,
            config,
        }
    }

    /// Runs until the event channel closes (process shutdown dropping the
    /// paired `Sender`): on `config.throttle_check_interval`, re-evaluates
    /// Tdarr worker limits against the active on-demand session count
    /// (`check_and_apply_throttle`); on each `MediaFileImportEvent`,
    /// dispatches that file to Tdarr if it needs it (`dispatch_one`).
    pub async fn run(mut self) -> Result<(), TranscodeError> {
        let mut throttle_interval = tokio::time::interval(self.config.throttle_check_interval);
        // `interval` fires immediately on its first tick; skip that one so
        // we don't hit Tdarr before anything has had a chance to change.
        throttle_interval.tick().await;

        loop {
            tokio::select! {
                _ = throttle_interval.tick() => {
                    if let Err(error) = self.check_and_apply_throttle().await {
                        tracing::warn!(%error, "tdarr worker-limit throttle check failed");
                    }
                }
                event = self.events_rx.recv() => {
                    match event {
                        Some(event) => {
                            if let Err(error) = self.dispatch_one(&event.media_file).await {
                                tracing::warn!(
                                    %error,
                                    media_file_id = %event.media_file.id,
                                    "failed to dispatch media file to tdarr",
                                );
                            }
                        }
                        None => {
                            tracing::info!("tdarr dispatcher event channel closed; shutting down");
                            return Ok(());
                        }
                    }
                }
            }
        }
    }

    /// Hands one `MediaFile` to Tdarr via `scan_individual_file`, unless a
    /// `Ready` rendition already covers it at `config.default_profile`.
    async fn dispatch_one(&self, media_file: &MediaFile) -> Result<(), TranscodeError> {
        let already_ready = self
            .rendition_repo
            .find_ready(media_file.id, &self.config.default_profile)
            .await?
            .is_some();

        if already_ready {
            tracing::debug!(
                media_file_id = %media_file.id,
                "skipping tdarr dispatch: ready rendition already exists",
            );
            return Ok(());
        }

        let request = ScanIndividualFileRequest {
            db_id: self.config.tdarr_db_id.clone(),
            file_path: media_file.path.to_string_lossy().into_owned(),
        };
        self.tdarr.scan_individual_file(&request).await?;
        Ok(())
    }

    /// Raises/lowers every connected Tdarr node's `config.worker_process`
    /// worker limit based on whether the active on-demand session count
    /// has crossed `config.active_session_threshold` — background
    /// transcoding backs off to leave capacity for live playback when the
    /// node is busy serving on-demand sessions, and resumes at its normal
    /// limit once it isn't.
    async fn check_and_apply_throttle(&self) -> Result<(), TranscodeError> {
        let active = self.active_sessions.get();
        let target_limit = if active >= self.config.active_session_threshold {
            self.config.throttled_worker_limit
        } else {
            self.config.default_worker_limit
        };

        let nodes = self.tdarr.get_nodes().await?;
        for node in nodes {
            self.tdarr
                .alter_worker_limit(&AlterWorkerLimitRequest {
                    node_id: node.node_id,
                    process: self.config.worker_process.clone(),
                    worker_limit: target_limit,
                })
                .await?;
        }

        Ok(())
    }
}

/// Canonicalises a codec name so common aliases compare equal:
/// `h265`/`hevc`/`h.265`/`x265`, `h264`/`avc`/`avc1`/`h.264`/`x264`, `av1`/`av01`.
/// `x264`/`x265` (and `libx264`/`libx265`) are encoder names that Radarr and
/// ffmpeg report instead of the codec; they are the same H.264/HEVC streams.
/// Unknown names are returned lower-cased and trimmed.
pub fn normalise_codec(codec: &str) -> String {
    let lower = codec.trim().to_ascii_lowercase();
    match lower.as_str() {
        "h265" | "h.265" | "hevc" | "hev1" | "hvc1" | "x265" | "libx265" => "hevc".to_string(),
        "h264" | "h.264" | "avc" | "avc1" | "x264" | "libx264" => "h264".to_string(),
        "av1" | "av01" => "av1".to_string(),
        _ => lower,
    }
}

/// Alias-aware, case-insensitive codec comparison.
pub fn codecs_match(a: &str, b: &str) -> bool {
    normalise_codec(a) == normalise_codec(b)
}

#[cfg(test)]
mod tests {
    #[test]
    fn external_audio_adds_second_input_and_maps_it() {
        let profile = TranscodeTargetProfile::resolve("720p");
        let ext = ExternalAudio {
            path: PathBuf::from("/scratch/s1.external-audio"),
        };
        let args = build_ffmpeg_hls_args_at_with_external_audio(
            Path::new("/m/a.mkv"),
            &profile,
            Path::new("/out"),
            90_000,
            &ext,
        );
        let joined = args.join(" ");
        assert_eq!(args.iter().filter(|a| *a == "-i").count(), 2);
        assert_eq!(args.iter().filter(|a| *a == "-ss").count(), 2);
        assert!(joined.contains("-map 0:v:0 -map 1:a:0"));
        assert!(joined.contains("-i /scratch/s1.external-audio"));
        // No credential-carrying option can reach the process arguments.
        assert!(!joined.contains("-headers"));
        assert!(!joined.contains("X-Api-Key"));
        assert!(!joined.contains("http"));
        // A short dub is padded with silence and the finite video ends output.
        assert!(joined.contains("-shortest -af aformat=channel_layouts=5.1|stereo|mono,apad"));
        assert!(!joined.contains("0:a:0?"));
    }

    #[test]
    fn video_copy_remuxes_the_video_and_packages_fragmented_mp4() {
        let ext = ExternalAudio {
            path: PathBuf::from("/scratch/s1.external-audio"),
        };
        let args = build_ffmpeg_hls_args_video_copy(
            Path::new("/m/a.mkv"),
            Path::new("/out"),
            0,
            None,
            Some(&ext),
            VideoCopy { hevc: true },
        );
        let joined = args.join(" ");
        assert!(joined.contains("-c:v copy -tag:v hvc1 -map 0:v:0 -map 1:a:0"));
        // Nothing that implies a video re-encode.
        for forbidden in ["libx264", "-pix_fmt", "-vf", "-b:v", "scale="] {
            assert!(!joined.contains(forbidden), "{forbidden} in {joined}");
        }
        assert!(joined.contains("-shortest -af aformat=channel_layouts=5.1|stereo|mono,apad"));
        assert!(joined.contains("-c:a aac -b:a 256k"));
        assert!(joined.contains("-hls_segment_type fmp4 -hls_fmp4_init_filename init.mp4"));
        assert!(joined.contains("/out/segment_%05d.m4s"));
        assert!(!joined.contains(".ts"));
    }

    #[test]
    fn video_copy_maps_a_selected_source_audio_stream_and_skips_hvc1_for_h264() {
        let args = build_ffmpeg_hls_args_video_copy(
            Path::new("/m/a.mkv"),
            Path::new("/out"),
            12_500,
            Some(3),
            None,
            VideoCopy { hevc: false },
        );
        let joined = args.join(" ");
        assert!(joined.contains("-ss 12.500 -i /m/a.mkv -c:v copy -map 0:v:0 -map 0:3"));
        assert!(!joined.contains("hvc1"));
        assert!(!joined.contains("apad"));
    }

    #[test]
    fn video_copy_is_offered_only_for_h264_and_hevc_sources() {
        assert_eq!(VideoCopy::for_codec("HEVC"), Some(VideoCopy { hevc: true }));
        assert_eq!(VideoCopy::for_codec("x265"), Some(VideoCopy { hevc: true }));
        assert_eq!(
            VideoCopy::for_codec("avc1"),
            Some(VideoCopy { hevc: false })
        );
        assert_eq!(VideoCopy::for_codec("av1"), None);
        assert_eq!(VideoCopy::for_codec("vc1"), None);
    }

    #[test]
    fn source_audio_transcode_is_not_padded() {
        let profile = TranscodeTargetProfile::resolve("720p");
        let args = build_ffmpeg_hls_args_at_with_audio(
            Path::new("/m/a.mkv"),
            &profile,
            Path::new("/out"),
            0,
            None,
        );
        assert!(!args.iter().any(|a| a.contains("apad") || a == "-shortest"));
        // Every encode folds the layout onto a standard AAC channel configuration.
        assert!(args
            .iter()
            .any(|a| a == "aformat=channel_layouts=5.1|stereo|mono"));
    }

    #[test]
    fn ffmpeg_decoder_encoder_and_filter_threads_have_safe_defaults() {
        let profile = TranscodeTargetProfile::resolve("720p");
        let args = build_ffmpeg_hls_args(Path::new("/m/a.mkv"), &profile, Path::new("/out"));
        for option in ["-threads:v", "-filter_threads", "-filter_complex_threads"] {
            let values: Vec<_> = args
                .windows(2)
                .filter(|window| window[0] == option)
                .map(|window| window[1].as_str())
                .collect();
            assert!(!values.is_empty(), "{option} must be set");
            assert!(values.iter().all(|value| *value == "2"));
        }
    }

    use super::*;
    use std::collections::HashMap as StdHashMap;
    use std::sync::Mutex as StdMutex;

    use async_trait::async_trait;
    use playarr_cache::InMemory;
    use playarr_model::media::LeafRef;
    use playarr_model::{ProducedBy, RenditionStatus};

    // ---- shared test fixtures --------------------------------------

    #[derive(Default)]
    struct FakeRenditionRepo {
        renditions: StdMutex<StdHashMap<Uuid, Rendition>>,
    }

    impl FakeRenditionRepo {
        fn with_ready(media_file_id: Uuid, profile: &str) -> Self {
            let repo = Self::default();
            let rendition = Rendition {
                id: Uuid::new_v4(),
                media_file_id,
                profile: profile.to_string(),
                container: "mp4".to_string(),
                codec: "h264".to_string(),
                bitrate: Some(4_000_000),
                output_path: PathBuf::from("/renditions/out/playlist.m3u8"),
                produced_by: ProducedBy::Tdarr,
                produced_at: Utc::now(),
                status: RenditionStatus::Ready,
            };
            repo.renditions
                .lock()
                .unwrap()
                .insert(rendition.id, rendition);
            repo
        }
    }

    #[async_trait]
    impl RenditionRepo for FakeRenditionRepo {
        async fn get(&self, id: Uuid) -> Result<Rendition, playarr_db::DbError> {
            self.renditions
                .lock()
                .unwrap()
                .get(&id)
                .cloned()
                .ok_or(playarr_db::DbError::NotFound)
        }

        async fn list_for_media_file(
            &self,
            media_file_id: Uuid,
        ) -> Result<Vec<Rendition>, playarr_db::DbError> {
            Ok(self
                .renditions
                .lock()
                .unwrap()
                .values()
                .filter(|r| r.media_file_id == media_file_id)
                .cloned()
                .collect())
        }

        async fn find_ready(
            &self,
            media_file_id: Uuid,
            profile: &str,
        ) -> Result<Option<Rendition>, playarr_db::DbError> {
            Ok(self
                .renditions
                .lock()
                .unwrap()
                .values()
                .find(|r| {
                    r.media_file_id == media_file_id
                        && r.profile == profile
                        && r.status == RenditionStatus::Ready
                })
                .cloned())
        }

        async fn upsert(&self, rendition: &Rendition) -> Result<(), playarr_db::DbError> {
            self.renditions
                .lock()
                .unwrap()
                .insert(rendition.id, rendition.clone());
            Ok(())
        }

        async fn delete(&self, id: Uuid) -> Result<(), playarr_db::DbError> {
            self.renditions.lock().unwrap().remove(&id);
            Ok(())
        }

        async fn mark_status(
            &self,
            id: Uuid,
            status: RenditionStatus,
        ) -> Result<(), playarr_db::DbError> {
            if let Some(rendition) = self.renditions.lock().unwrap().get_mut(&id) {
                rendition.status = status;
            }
            Ok(())
        }
    }

    fn sample_media_file() -> MediaFile {
        MediaFile {
            id: Uuid::new_v4(),
            work_id: Uuid::new_v4(),
            leaf_ref: LeafRef::Work,
            path: PathBuf::from("/media/movies/Sample (2024)/Sample.mkv"),
            container: "mkv".to_string(),
            codec: "hevc".to_string(),
            bitrate: Some(15_000_000),
            duration_ms: None,
            size_bytes: 4_000_000_000,
            source_instance_id: Uuid::new_v4(),
            source_file_id: Some("123".to_string()),
        }
    }

    fn sample_capabilities() -> ClientCapabilities {
        ClientCapabilities {
            supported_containers: vec!["mp4".to_string()],
            supported_video_codecs: vec!["h264".to_string()],
            supported_audio_codecs: vec!["aac".to_string()],
            max_bitrate_bps: Some(10_000_000),
        }
    }

    fn unique_tmp_dir() -> PathBuf {
        std::env::temp_dir().join(format!("playarr-transcode-test-{}", Uuid::new_v4()))
    }

    fn test_orchestrator(rendition_repo: Arc<dyn RenditionRepo>) -> TranscodeOrchestrator {
        TranscodeOrchestrator::new(
            rendition_repo,
            Arc::new(InMemory::new()),
            ActiveSessionCounter::new(),
        )
        .with_ffmpeg_binary("/usr/bin/true")
        .with_output_root(unique_tmp_dir())
    }

    // ---- can_direct_play ---------------------------------------------

    mod can_direct_play {
        use super::*;

        #[test]
        fn codec_aliases_normalise_both_ways() {
            for (a, b) in [
                ("h265", "hevc"),
                ("hevc", "h265"),
                ("HEVC", "H265"),
                ("h264", "avc"),
                ("avc", "h264"),
                ("av1", "av01"),
                ("av01", "av1"),
            ] {
                assert!(codecs_match(a, b), "{a} should match {b}");
            }
            assert!(!codecs_match("hevc", "h264"));
            assert!(!codecs_match("av1", "vp9"));
        }

        #[test]
        fn can_direct_play_matches_codec_aliases() {
            let orchestrator = test_orchestrator(Arc::new(FakeRenditionRepo::default()));
            for (file_codec, client_codec) in [
                ("hevc", "h265"),
                ("h265", "hevc"),
                ("avc", "h264"),
                ("h264", "avc"),
                ("av01", "av1"),
                ("av1", "av01"),
                ("x265", "hevc"),
                ("x265", "h265"),
                ("x264", "h264"),
                ("libx264", "avc"),
            ] {
                let mut media_file = sample_media_file();
                media_file.container = "mp4".to_string();
                media_file.codec = file_codec.to_string();
                media_file.bitrate = Some(4_000_000);
                let mut capabilities = sample_capabilities();
                capabilities.supported_video_codecs = vec![client_codec.to_string()];
                assert!(
                    orchestrator.can_direct_play(&media_file, &capabilities),
                    "{file_codec} should direct play for client codec {client_codec}"
                );
            }

            let mut media_file = sample_media_file();
            media_file.container = "mp4".to_string();
            media_file.codec = "hevc".to_string();
            let mut capabilities = sample_capabilities();
            capabilities.supported_video_codecs = vec!["h264".to_string()];
            assert!(!orchestrator.can_direct_play(&media_file, &capabilities));
        }

        #[test]
        fn direct_play_when_everything_matches() {
            let orchestrator = test_orchestrator(Arc::new(FakeRenditionRepo::default()));
            let mut media_file = sample_media_file();
            media_file.container = "mp4".to_string();
            media_file.codec = "h264".to_string();
            media_file.bitrate = Some(4_000_000);

            assert!(orchestrator.can_direct_play(&media_file, &sample_capabilities()));
        }

        #[test]
        fn audio_only_file_matches_audio_capabilities() {
            let orchestrator = test_orchestrator(Arc::new(FakeRenditionRepo::default()));
            let mut media_file = sample_media_file();
            media_file.container = "mp3".to_string();
            media_file.codec = "mp3".to_string();
            media_file.bitrate = Some(320_000);
            let mut capabilities = sample_capabilities();
            capabilities.supported_containers.push("mp3".to_string());
            capabilities.supported_audio_codecs.push("mp3".to_string());

            assert!(orchestrator.can_direct_play(&media_file, &capabilities));
        }

        #[test]
        fn unsupported_container_forces_transcode() {
            let orchestrator = test_orchestrator(Arc::new(FakeRenditionRepo::default()));
            let mut media_file = sample_media_file();
            media_file.container = "mkv".to_string();
            media_file.codec = "h264".to_string();
            media_file.bitrate = Some(4_000_000);

            assert!(!orchestrator.can_direct_play(&media_file, &sample_capabilities()));
        }

        #[test]
        fn unsupported_video_codec_forces_transcode() {
            let orchestrator = test_orchestrator(Arc::new(FakeRenditionRepo::default()));
            let mut media_file = sample_media_file();
            media_file.container = "mp4".to_string();
            media_file.codec = "hevc".to_string();
            media_file.bitrate = Some(4_000_000);

            assert!(!orchestrator.can_direct_play(&media_file, &sample_capabilities()));
        }

        #[test]
        fn bitrate_over_client_cap_forces_transcode() {
            let orchestrator = test_orchestrator(Arc::new(FakeRenditionRepo::default()));
            let mut media_file = sample_media_file();
            media_file.container = "mp4".to_string();
            media_file.codec = "h264".to_string();
            media_file.bitrate = Some(20_000_000);

            assert!(!orchestrator.can_direct_play(&media_file, &sample_capabilities()));
        }

        #[test]
        fn container_comparison_is_case_insensitive() {
            let orchestrator = test_orchestrator(Arc::new(FakeRenditionRepo::default()));
            let mut media_file = sample_media_file();
            media_file.container = "MP4".to_string();
            media_file.codec = "h264".to_string();
            media_file.bitrate = Some(4_000_000);

            assert!(orchestrator.can_direct_play(&media_file, &sample_capabilities()));
        }

        #[test]
        fn unknown_source_bitrate_does_not_block_direct_play() {
            let orchestrator = test_orchestrator(Arc::new(FakeRenditionRepo::default()));
            let mut media_file = sample_media_file();
            media_file.container = "mp4".to_string();
            media_file.codec = "h264".to_string();
            media_file.bitrate = None;

            assert!(orchestrator.can_direct_play(&media_file, &sample_capabilities()));
        }

        #[test]
        fn uncapped_client_does_not_block_direct_play() {
            let orchestrator = test_orchestrator(Arc::new(FakeRenditionRepo::default()));
            let mut media_file = sample_media_file();
            media_file.container = "mp4".to_string();
            media_file.codec = "h264".to_string();
            media_file.bitrate = Some(50_000_000);

            let mut capabilities = sample_capabilities();
            capabilities.max_bitrate_bps = None;

            assert!(orchestrator.can_direct_play(&media_file, &capabilities));
        }
    }

    // ---- ffmpeg command construction ----------------------------------

    mod hdr_args {
        use super::*;
        use crate::video::{parse_source_video, SourceVideo};

        fn try_args_for(
            source: &SourceVideo,
            libplacebo: bool,
        ) -> Result<Vec<String>, TranscodeError> {
            let tone_map = video::ToneMapSupport {
                zscale: true,
                libplacebo,
                libplacebo_fps: None,
            };
            build_hls_args(
                Path::new("/media/in.mkv"),
                &TranscodeTargetProfile::resolve("h264-720p-4mbps"),
                Path::new("/tmp/s"),
                0,
                None,
                None,
                None,
                2,
                Some(source),
                tone_map,
                StreamHints::default(),
            )
        }

        fn args_for(source: &SourceVideo, libplacebo: bool) -> Vec<String> {
            try_args_for(source, libplacebo).unwrap()
        }

        fn value<'a>(args: &'a [String], flag: &str) -> &'a str {
            &args[args.iter().position(|a| a == flag).unwrap() + 1]
        }

        const DV5: &str = r#"{"streams":[{"color_range":"pc","pix_fmt":"yuv420p10le","side_data_list":[
          {"side_data_type":"DOVI configuration record","dv_profile":5,"dv_bl_signal_compatibility_id":0}]}]}"#;

        #[test]
        fn hdr10_transcode_is_scaled_then_tone_mapped_and_tagged_bt709_limited() {
            let s = parse_source_video(br#"{"streams":[{"color_transfer":"smpte2084"}]}"#).unwrap();
            let args = args_for(&s, false);
            let vf = value(&args, "-vf");
            assert!(vf.starts_with("scale=-2:min(720\\,ih),zscale="), "{vf}");
            assert!(vf.contains("tonemap=tonemap=hable"));
            // Frame properties carry the tags; ffmpeg 7+ ignores the encoder options.
            assert!(vf.ends_with(
                "setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv"
            ));
            assert_eq!(value(&args, "-pix_fmt"), "yuv420p");
            assert_eq!(value(&args, "-colorspace"), "bt709");
            assert_eq!(value(&args, "-color_primaries"), "bt709");
            assert_eq!(value(&args, "-color_trc"), "bt709");
            assert_eq!(value(&args, "-color_range"), "tv");
        }

        #[test]
        fn dv5_with_libplacebo_gets_a_vulkan_device_before_the_input() {
            let s = parse_source_video(DV5.as_bytes()).unwrap();
            let args = args_for(&s, true);
            assert!(
                args.iter().position(|a| a == "-init_hw_device").unwrap()
                    < args.iter().position(|a| a == "-i").unwrap()
            );
            assert!(value(&args, "-vf").contains(",libplacebo="));
            // Guard: without a fast enough libplacebo a profile 5 source has no transcode path.
            assert!(matches!(
                try_args_for(&s, false),
                Err(TranscodeError::UnsupportedColour)
            ));
        }

        /// Guard (owner ruling): whatever the node supports, a profile 5 transcode either runs
        /// libplacebo (which applies the RPU) or is refused.
        #[test]
        fn dv5_never_reaches_an_output_that_skips_the_rpu() {
            let s = parse_source_video(DV5.as_bytes()).unwrap();
            for libplacebo in [false, true] {
                match try_args_for(&s, libplacebo) {
                    Ok(args) => {
                        assert!(libplacebo);
                        assert!(value(&args, "-vf").contains("libplacebo="));
                        assert!(!value(&args, "-vf").contains("zscale"));
                    }
                    Err(e) => {
                        assert!(matches!(e, TranscodeError::UnsupportedColour) && !libplacebo)
                    }
                }
            }
        }

        #[test]
        fn a_download_is_one_fast_start_mp4_at_the_profile_with_the_picture_rules() {
            let hdr10 =
                parse_source_video(br#"{"streams":[{"color_transfer":"smpte2084"}]}"#).unwrap();
            let profile = TranscodeTargetProfile::resolve("h264-480p-2mbps");
            let args = build_download_args(
                Path::new("/m/in.mkv"),
                &profile,
                Path::new("/d/t.mp4"),
                2,
                &hdr10,
                video::ToneMapSupport::default(),
                &DownloadTracks::default(),
            )
            .unwrap();
            let joined = args.join(" ");
            assert!(
                joined.contains("-movflags +faststart -f mp4 /d/t.mp4"),
                "{joined}"
            );
            assert!(!joined.contains("hls"));
            let vf = value(&args, "-vf");
            assert!(vf.starts_with(&format!("scale=-2:min({}", profile.height)));
            assert!(vf.contains("tonemap=") && vf.ends_with("range=tv"));
            assert_eq!(value(&args, "-c:v"), profile.video_codec);
            assert_eq!(
                value(&args, "-b:v"),
                format!("{}k", profile.video_bitrate_kbps.unwrap())
            );
            assert_eq!(value(&args, "-colorspace"), "bt709");
        }

        #[test]
        fn a_download_keeps_the_chosen_audio_and_text_subtitles() {
            let sdr = SourceVideo::default();
            let profile = TranscodeTargetProfile::resolve("h264-480p-2mbps");
            let tracks = DownloadTracks {
                audio_stream_index: Some(3),
                subtitles: vec![(5, Some("en".into())), (6, None)],
            };
            let args = build_download_args(
                Path::new("/m/in.mkv"),
                &profile,
                Path::new("/d/t.mp4"),
                2,
                &sdr,
                video::ToneMapSupport::default(),
                &tracks,
            )
            .unwrap();
            let joined = args.join(" ");
            assert!(
                joined.contains("-map 0:v:0 -map 0:3 -map 0:5 -map 0:6"),
                "{joined}"
            );
            assert!(
                joined.contains("-c:s mov_text -metadata:s:s:0 language=en"),
                "{joined}"
            );
            assert!(!args.contains(&"-sn".to_string()));
            // No tracks chosen: the first audio track and no subtitles, as before.
            let plain = build_download_args(
                Path::new("/m/in.mkv"),
                &profile,
                Path::new("/d/t.mp4"),
                2,
                &sdr,
                video::ToneMapSupport::default(),
                &DownloadTracks::default(),
            )
            .unwrap();
            assert!(plain.join(" ").contains("-map 0:a:0? -sn"));
        }

        #[test]
        fn a_profile_5_download_needs_libplacebo_like_playback() {
            let s = parse_source_video(DV5.as_bytes()).unwrap();
            let profile = TranscodeTargetProfile::resolve("h264-480p-2mbps");
            let build = |libplacebo| {
                build_download_args(
                    Path::new("/m/in.mkv"),
                    &profile,
                    Path::new("/d/t.mp4"),
                    2,
                    &s,
                    video::ToneMapSupport {
                        zscale: true,
                        libplacebo,
                        libplacebo_fps: None,
                    },
                    &DownloadTracks::default(),
                )
            };
            assert!(matches!(
                build(false),
                Err(TranscodeError::UnsupportedColour)
            ));
            let args = build(true).unwrap();
            assert!(value(&args, "-vf").contains("libplacebo="));
            assert_eq!(args[0], "-init_hw_device");
        }

        #[test]
        fn an_unprobed_hevc_copy_is_refused() {
            let copy = |hevc| {
                build_hls_args(
                    Path::new("/media/in.mkv"),
                    &TranscodeTargetProfile::resolve(""),
                    Path::new("/tmp/s"),
                    0,
                    None,
                    None,
                    Some(VideoCopy { hevc }),
                    2,
                    None,
                    video::ToneMapSupport::default(),
                    StreamHints::default(),
                )
            };
            assert!(matches!(copy(true), Err(TranscodeError::UnsupportedColour)));
            // H.264 carries no profile 5, so an unprobed copy of it is fine.
            assert!(copy(false).is_ok());
        }

        #[test]
        fn dv5_copy_is_refused_unless_the_device_renders_it() {
            let s = parse_source_video(DV5.as_bytes()).unwrap();
            let copy = |allowed| {
                build_hls_args(
                    Path::new("/media/in.mkv"),
                    &TranscodeTargetProfile::resolve(""),
                    Path::new("/tmp/s"),
                    0,
                    None,
                    None,
                    Some(VideoCopy { hevc: true }),
                    2,
                    Some(&s),
                    video::ToneMapSupport::default(),
                    StreamHints {
                        dv_copy_allowed: allowed,
                        ..StreamHints::default()
                    },
                )
            };
            assert!(matches!(
                copy(false),
                Err(TranscodeError::UnsupportedColour)
            ));
            assert!(copy(true).is_ok());
        }

        fn copy_args(hints: StreamHints) -> Vec<String> {
            let args = build_hls_args(
                Path::new("/media/in.mkv"),
                &TranscodeTargetProfile::resolve(""),
                Path::new("/tmp/s"),
                0,
                None,
                None,
                Some(VideoCopy { hevc: true }),
                2,
                Some(&SourceVideo::default()),
                video::ToneMapSupport::default(),
                hints,
            );
            args.unwrap()
        }

        #[test]
        fn hevc_copy_strips_the_dovi_rpu_only_when_asked() {
            let strip = copy_args(StreamHints {
                strip_dovi: true,
                ..StreamHints::default()
            });
            assert_eq!(value(&strip, "-bsf:v"), "dovi_rpu=strip=1");
            assert!(!copy_args(StreamHints::default()).contains(&"-bsf:v".to_string()));
        }

        #[test]
        fn stereo_device_gets_a_stereo_aac_fold() {
            let stereo = copy_args(StreamHints {
                max_audio_channels: Some(2),
                ..StreamHints::default()
            });
            assert_eq!(value(&stereo, "-af"), "aformat=channel_layouts=stereo|mono");
            assert_eq!(
                value(&copy_args(StreamHints::default()), "-af"),
                AAC_CHANNEL_LAYOUTS_FILTER
            );
        }

        #[test]
        fn full_range_sdr_is_forced_to_limited_range() {
            let s = parse_source_video(br#"{"streams":[{"color_range":"pc"}]}"#).unwrap();
            let args = args_for(&s, false);
            assert!(value(&args, "-vf").contains(",scale=out_range=tv,setparams="));
        }
    }

    mod ffmpeg_args {
        use super::*;

        #[test]
        fn builds_expected_argv_with_bitrates() {
            let profile = TranscodeTargetProfile {
                name: "h264-720p-4mbps".to_string(),
                height: 720,
                video_codec: "libx264".to_string(),
                audio_codec: "aac".to_string(),
                quality_level: TranscodeQualityLevel::Medium,
                video_bitrate_kbps: Some(4000),
                audio_bitrate_kbps: Some(128),
            };

            let args = build_ffmpeg_hls_args(
                Path::new("/media/in.mkv"),
                &profile,
                Path::new("/tmp/session-1"),
            );

            let expected: Vec<String> = [
                "-y",
                "-threads:v",
                "2",
                "-filter_threads",
                "2",
                "-filter_complex_threads",
                "2",
                "-i",
                "/media/in.mkv",
                "-c:v",
                "libx264",
                "-threads:v",
                "2",
                "-pix_fmt",
                "yuv420p",
                "-preset",
                "veryfast",
                "-force_key_frames",
                "expr:gte(t,n_forced*4)",
                "-map",
                "0:v:0",
                "-map",
                "0:a:0?",
                "-sn",
                "-af",
                "aformat=channel_layouts=5.1|stereo|mono",
                "-vf",
                "scale=-2:min(720\\,ih)",
                "-b:v",
                "4000k",
                "-c:a",
                "aac",
                "-b:a",
                "128k",
                "-f",
                "hls",
                "-hls_time",
                "4",
                "-hls_playlist_type",
                "event",
                "-hls_list_size",
                "0",
                "-hls_segment_filename",
                "/tmp/session-1/segment_%05d.ts",
                "/tmp/session-1/playlist.m3u8",
            ]
            .into_iter()
            .map(str::to_string)
            .collect();

            assert_eq!(args, expected);
        }

        #[test]
        fn omits_bitrate_flags_when_profile_has_none() {
            let profile = TranscodeTargetProfile {
                name: "custom".to_string(),
                height: 0,
                video_codec: "libx264".to_string(),
                audio_codec: "aac".to_string(),
                quality_level: TranscodeQualityLevel::Medium,
                video_bitrate_kbps: None,
                audio_bitrate_kbps: None,
            };

            let args = build_ffmpeg_hls_args(
                Path::new("/media/in.mkv"),
                &profile,
                Path::new("/tmp/session-2"),
            );

            assert!(!args.iter().any(|a| a == "-b:v"));
            assert!(!args.iter().any(|a| a == "-b:a"));
            assert!(args.iter().any(|a| a == "-c:v"));
            assert!(args.iter().any(|a| a == "-c:a"));
            assert_eq!(
                args[args.iter().position(|a| a == "-pix_fmt").unwrap() + 1],
                "yuv420p"
            );
        }

        #[test]
        fn input_and_output_paths_are_positioned_correctly() {
            let profile = TranscodeTargetProfile::resolve("h264-480p-2mbps");
            let args = build_ffmpeg_hls_args(
                Path::new("/library/movie.mkv"),
                &profile,
                Path::new("/tmp/session-3"),
            );

            let i_index = args.iter().position(|a| a == "-i").unwrap();
            assert_eq!(args[i_index + 1], "/library/movie.mkv");

            // The playlist path (the ffmpeg output) is always the final
            // argument.
            assert_eq!(args.last().unwrap(), "/tmp/session-3/playlist.m3u8");
        }

        #[test]
        fn source_seek_is_applied_before_input_with_millisecond_precision() {
            let profile = TranscodeTargetProfile::resolve("h264-720p-4mbps");
            let args = build_ffmpeg_hls_args_at(
                Path::new("/library/episode.mkv"),
                &profile,
                Path::new("/tmp/session-seek"),
                1_234_567,
            );

            let seek_index = args.iter().position(|arg| arg == "-ss").unwrap();
            let input_index = args.iter().position(|arg| arg == "-i").unwrap();
            assert_eq!(args[seek_index + 1], "1234.567");
            assert!(seek_index < input_index);
        }

        #[test]
        fn maps_the_selected_global_source_audio_stream() {
            let profile = TranscodeTargetProfile::resolve("h264-720p-4mbps");
            let args = build_ffmpeg_hls_args_at_with_audio(
                Path::new("/library/episode.mkv"),
                &profile,
                Path::new("/tmp/session-audio"),
                45_000,
                Some(4),
            );

            let maps = args
                .windows(2)
                .filter(|pair| pair[0] == "-map")
                .map(|pair| pair[1].as_str())
                .collect::<Vec<_>>();
            assert_eq!(maps, vec!["0:v:0", "0:4"]);
            assert!(args.iter().any(|arg| arg == "-sn"));
        }

        #[test]
        fn selected_quality_caps_the_real_output_height_without_upscaling() {
            let profile = TranscodeTargetProfile::resolve("h264-480p-2mbps");
            let args = build_ffmpeg_hls_args(
                Path::new("/library/episode.mkv"),
                &profile,
                Path::new("/tmp/session-quality"),
            );

            let filter_index = args.iter().position(|arg| arg == "-vf").unwrap();
            assert_eq!(args[filter_index + 1], "scale=-2:min(480\\,ih)");
        }

        #[test]
        fn resolve_known_profile_maps_expected_codecs_and_bitrate() {
            let profile = TranscodeTargetProfile::resolve("h264-1080p-8mbps");
            assert_eq!(profile.height, 1080);
            assert_eq!(profile.video_codec, "libx264");
            assert_eq!(profile.audio_codec, "aac");
            assert_eq!(profile.video_bitrate_kbps, Some(8000));
            assert_eq!(profile.audio_bitrate_kbps, Some(192));
        }

        #[test]
        fn resolve_unknown_profile_falls_back_to_a_sane_default() {
            let profile = TranscodeTargetProfile::resolve("totally-unrecognized-profile");
            assert_eq!(profile.height, 720);
            assert_eq!(profile.video_codec, "libx264");
            assert_eq!(profile.audio_codec, "aac");
            assert!(profile.video_bitrate_kbps.is_some());
        }

        #[test]
        fn supported_profiles_are_the_real_ladder_in_display_order() {
            let profiles = TranscodeTargetProfile::supported();
            assert_eq!(
                profiles
                    .iter()
                    .map(|profile| profile.height)
                    .collect::<Vec<_>>(),
                vec![2160, 2160, 2160, 1080, 1080, 1080, 720, 720, 720, 480, 480, 480]
            );
            assert_eq!(profiles[0].name, "h264-2160p-12mbps");
            assert_eq!(profiles[1].quality_level, TranscodeQualityLevel::Medium);
            assert_eq!(profiles[11].video_bitrate_kbps, Some(3000));
        }
    }

    // ---- TranscodeSession lifecycle -----------------------------------

    mod session_lifecycle {
        use super::*;

        #[cfg(unix)]
        async fn sleeping_ffmpeg(root: &Path) -> PathBuf {
            use std::os::unix::fs::PermissionsExt;

            tokio::fs::create_dir_all(root).await.unwrap();
            let path = root.join("ffmpeg-sleeper");
            tokio::fs::write(&path, "#!/bin/sh\n# Answers the start-up `-filters` probe at once; any other call stands in for a transcode.\n[ \"$2\" = -filters ] && exit 0\nexec /usr/bin/sleep 30\n")
                .await
                .unwrap();
            let mut permissions = tokio::fs::metadata(&path).await.unwrap().permissions();
            permissions.set_mode(0o755);
            tokio::fs::set_permissions(&path, permissions)
                .await
                .unwrap();
            path
        }

        #[tokio::test]
        async fn spawn_creates_a_lookupable_session_and_expire_removes_it() {
            let repo = Arc::new(FakeRenditionRepo::default());
            let counter = ActiveSessionCounter::new();
            let orchestrator =
                TranscodeOrchestrator::new(repo, Arc::new(InMemory::new()), counter.clone())
                    .with_ffmpeg_binary("/usr/bin/true")
                    .with_output_root(unique_tmp_dir());

            let media_file = sample_media_file();
            let session = orchestrator
                .spawn_on_demand_transcode(&media_file, "h264-720p-4mbps", "node-a")
                .await
                .expect("spawn should succeed with /usr/bin/true standing in for ffmpeg");

            assert_eq!(session.media_file_id, media_file.id);
            assert_eq!(session.profile, "h264-720p-4mbps");
            assert_eq!(session.owning_node_id, "node-a");
            assert_eq!(session.current_segment, 0);
            assert_eq!(counter.get(), 1);

            // `lookup_session` slides `expires_at` forward on every real
            // access (see its doc comment) -- compare everything else
            // exactly, and only assert `expires_at` moved forward rather
            // than expecting a byte-for-byte match against the
            // just-created `session`.
            let found = orchestrator
                .lookup_session(session.id)
                .await
                .expect("lookup should not error")
                .expect("session should be found");
            assert_eq!(found.id, session.id);
            assert_eq!(found.media_file_id, session.media_file_id);
            assert_eq!(found.profile, session.profile);
            assert_eq!(found.owning_node_id, session.owning_node_id);
            assert_eq!(found.current_segment, session.current_segment);
            assert!(found.expires_at >= session.expires_at);

            orchestrator
                .expire_session(session.id)
                .await
                .expect("expire should not error");
            assert_eq!(counter.get(), 0);

            let after_expiry = orchestrator
                .lookup_session(session.id)
                .await
                .expect("lookup should not error");
            assert_eq!(after_expiry, None);
        }

        #[cfg(unix)]
        #[tokio::test]
        async fn reaper_stops_processes_whose_session_expired_from_the_cache() {
            let counter = ActiveSessionCounter::new();
            let root = unique_tmp_dir();
            // A process that stays alive: `/usr/bin/true` may already have
            // exited, in which case the reaper's finished-child pass releases
            // the slot before the first assertion (a race).
            let sleeper = sleeping_ffmpeg(&root).await;
            let orchestrator = TranscodeOrchestrator::new(
                Arc::new(FakeRenditionRepo::default()),
                Arc::new(InMemory::new()),
                counter.clone(),
            )
            .with_ffmpeg_binary(sleeper.to_string_lossy().into_owned())
            .with_output_root(root.join("output"))
            .with_session_ttl(Duration::from_millis(500));
            let session = orchestrator
                .spawn_on_demand_transcode(&sample_media_file(), "h264-720p-4mbps", "node-a")
                .await
                .unwrap();
            // Still within its idle window: left alone.
            assert_eq!(orchestrator.reap_idle_sessions().await, 0);
            assert_eq!(counter.get(), 1);

            tokio::time::sleep(Duration::from_millis(800)).await;
            assert_eq!(orchestrator.reap_idle_sessions().await, 1);
            assert_eq!(counter.get(), 0);
            assert!(!orchestrator.session_output_dir(session.id).exists());
            assert_eq!(orchestrator.reap_idle_sessions().await, 0);
        }

        #[tokio::test]
        async fn fetched_audio_is_local_removed_with_the_session_and_failure_spawns_nothing() {
            let counter = ActiveSessionCounter::new();
            let orchestrator = TranscodeOrchestrator::new(
                Arc::new(FakeRenditionRepo::default()),
                Arc::new(InMemory::new()),
                counter.clone(),
            )
            .with_ffmpeg_binary("/usr/bin/true")
            .with_output_root(unique_tmp_dir());
            let media_file = sample_media_file();

            let seen = Arc::new(StdMutex::new(None::<PathBuf>));
            let seen_in_fetch = seen.clone();
            let session = orchestrator
                .spawn_on_demand_transcode_with_fetched_audio(
                    &media_file,
                    "h264-720p-4mbps",
                    "node-a",
                    0,
                    StreamHints::default(),
                    |path| async move {
                        tokio::fs::write(&path, b"dub")
                            .await
                            .map_err(|e| e.to_string())?;
                        *seen_in_fetch.lock().unwrap() = Some(path);
                        Ok(())
                    },
                )
                .await
                .unwrap();
            let path = seen.lock().unwrap().clone().expect("fetch ran");
            assert!(path.exists());
            // Outside the HLS output directory, so the session route can never serve it.
            assert!(!path.starts_with(orchestrator.session_output_dir(session.id)));
            orchestrator.expire_session(session.id).await.unwrap();
            assert!(!path.exists());
            assert_eq!(counter.get(), 0);

            let failed = orchestrator
                .spawn_on_demand_transcode_with_fetched_audio(
                    &media_file,
                    "h264-720p-4mbps",
                    "node-a",
                    0,
                    StreamHints::default(),
                    |_| async { Err("dubarr down".to_string()) },
                )
                .await;
            assert!(matches!(failed, Err(TranscodeError::ExternalAudio(_))));
            assert_eq!(counter.get(), 0);
        }

        #[tokio::test]
        async fn lookup_of_unknown_session_is_none() {
            let orchestrator = test_orchestrator(Arc::new(FakeRenditionRepo::default()));
            assert_eq!(
                orchestrator.lookup_session(Uuid::new_v4()).await.unwrap(),
                None
            );
        }

        #[tokio::test]
        async fn expiring_an_unknown_session_is_not_an_error() {
            let orchestrator = test_orchestrator(Arc::new(FakeRenditionRepo::default()));
            orchestrator.expire_session(Uuid::new_v4()).await.unwrap();
        }

        #[tokio::test]
        async fn expiring_a_playback_session_stops_its_associated_transcode() {
            let repo = Arc::new(FakeRenditionRepo::default());
            let counter = ActiveSessionCounter::new();
            let orchestrator =
                TranscodeOrchestrator::new(repo, Arc::new(InMemory::new()), counter.clone())
                    .with_ffmpeg_binary("/usr/bin/true")
                    .with_output_root(unique_tmp_dir());
            let session = orchestrator
                .spawn_on_demand_transcode(&sample_media_file(), "h264-720p-4mbps", "node-a")
                .await
                .unwrap();
            let playback_session_id = Uuid::new_v4();

            orchestrator
                .associate_playback_session(playback_session_id, session.id)
                .await
                .unwrap();
            orchestrator
                .expire_playback_session(playback_session_id)
                .await
                .unwrap();

            assert_eq!(counter.get(), 0);
            assert_eq!(orchestrator.lookup_session(session.id).await.unwrap(), None);
            assert!(!orchestrator.session_output_dir(session.id).exists());
        }

        #[tokio::test]
        async fn replacing_a_playback_sessions_transcode_expires_the_old_one() {
            let repo = Arc::new(FakeRenditionRepo::default());
            let counter = ActiveSessionCounter::new();
            let orchestrator =
                TranscodeOrchestrator::new(repo, Arc::new(InMemory::new()), counter.clone())
                    .with_ffmpeg_binary("/usr/bin/true")
                    .with_output_root(unique_tmp_dir())
                    .with_max_concurrent_sessions(2);
            let media_file = sample_media_file();
            let first = orchestrator
                .spawn_on_demand_transcode(&media_file, "profile-a", "node-a")
                .await
                .unwrap();
            let second = orchestrator
                .spawn_on_demand_transcode(&media_file, "profile-b", "node-a")
                .await
                .unwrap();
            let playback_session_id = Uuid::new_v4();

            orchestrator
                .associate_playback_session(playback_session_id, first.id)
                .await
                .unwrap();
            orchestrator
                .associate_playback_session(playback_session_id, second.id)
                .await
                .unwrap();

            assert_eq!(orchestrator.lookup_session(first.id).await.unwrap(), None);
            assert!(orchestrator
                .lookup_session(second.id)
                .await
                .unwrap()
                .is_some());
            assert_eq!(counter.get(), 1);
        }

        #[tokio::test]
        async fn session_passively_expires_once_its_ttl_elapses() {
            let repo = Arc::new(FakeRenditionRepo::default());
            let orchestrator = TranscodeOrchestrator::new(
                repo,
                Arc::new(InMemory::new()),
                ActiveSessionCounter::new(),
            )
            .with_ffmpeg_binary("/usr/bin/true")
            .with_output_root(unique_tmp_dir())
            .with_session_ttl(Duration::from_millis(20));

            let media_file = sample_media_file();
            let session = orchestrator
                .spawn_on_demand_transcode(&media_file, "h264-720p-4mbps", "node-a")
                .await
                .unwrap();

            tokio::time::sleep(Duration::from_millis(150)).await;

            let found = orchestrator.lookup_session(session.id).await.unwrap();
            assert_eq!(found, None);
        }

        /// The bug this guards against: a real on-demand session (a movie
        /// actually being watched) outlives a single `session_ttl` window
        /// because every real request re-touches it -- `session_ttl` is an
        /// *idle* deadline, not a hard cap on total session lifetime (see
        /// `TranscodeSession::expires_at`'s doc comment). Confirmed live
        /// before this fix: a real playback session played its first few
        /// segments fine, then 404'd mid-playback the moment the fixed 60s
        /// window from creation elapsed, regardless of how continuously it
        /// was being watched.
        #[tokio::test]
        async fn repeated_lookups_keep_an_actively_watched_session_alive_past_its_ttl() {
            let repo = Arc::new(FakeRenditionRepo::default());
            let orchestrator = TranscodeOrchestrator::new(
                repo,
                Arc::new(InMemory::new()),
                ActiveSessionCounter::new(),
            )
            .with_ffmpeg_binary("/usr/bin/true")
            .with_output_root(unique_tmp_dir())
            .with_session_ttl(Duration::from_millis(80));

            let media_file = sample_media_file();
            let session = orchestrator
                .spawn_on_demand_transcode(&media_file, "h264-720p-4mbps", "node-a")
                .await
                .unwrap();

            // Simulate a player polling the manifest/segments well past what
            // a single `session_ttl` window would allow if nothing refreshed
            // it -- 6 rounds x 40ms = 240ms, versus an 80ms TTL.
            for _ in 0..6 {
                tokio::time::sleep(Duration::from_millis(40)).await;
                let found = orchestrator
                    .lookup_session(session.id)
                    .await
                    .unwrap()
                    .expect("an actively-polled session must not expire between accesses");
                assert_eq!(found.id, session.id);
            }

            // Once real access actually stops, the session still expires
            // (this is deliberately idle cleanup, not immortality) --
            // roughly `session_ttl` after the last real lookup above.
            tokio::time::sleep(Duration::from_millis(150)).await;
            let found = orchestrator.lookup_session(session.id).await.unwrap();
            assert_eq!(found, None);
        }

        #[cfg(unix)]
        #[tokio::test]
        async fn no_capacity_error_once_max_concurrent_sessions_reached() {
            let root = unique_tmp_dir();
            let sleeper = sleeping_ffmpeg(&root).await;
            let repo = Arc::new(FakeRenditionRepo::default());
            let orchestrator = TranscodeOrchestrator::new(
                repo,
                Arc::new(InMemory::new()),
                ActiveSessionCounter::new(),
            )
            .with_ffmpeg_binary(sleeper.to_string_lossy().into_owned())
            .with_output_root(root.join("output"))
            .with_max_concurrent_sessions(1);

            let media_file = sample_media_file();
            orchestrator
                .spawn_on_demand_transcode(&media_file, "profile-a", "node-a")
                .await
                .expect("first session should have capacity");

            let second = orchestrator
                .spawn_on_demand_transcode(&media_file, "profile-b", "node-a")
                .await;

            assert!(matches!(second, Err(TranscodeError::NoCapacity)));
        }

        #[tokio::test]
        async fn spawn_error_releases_admission_permit() {
            let orchestrator = TranscodeOrchestrator::new(
                Arc::new(FakeRenditionRepo::default()),
                Arc::new(InMemory::new()),
                ActiveSessionCounter::new(),
            )
            .with_ffmpeg_binary("/definitely/missing/playarr-ffmpeg")
            .with_output_root(unique_tmp_dir())
            .with_max_concurrent_sessions(1);

            let error = orchestrator
                .spawn_on_demand_transcode(&sample_media_file(), "profile-a", "node-a")
                .await
                .expect_err("missing executable must fail to spawn");
            assert!(matches!(error, TranscodeError::Io(_)));
            assert!(orchestrator
                .reserve_capacity(FULL_TRANSCODE_PERMITS)
                .await
                .is_ok());
        }

        #[tokio::test]
        async fn concurrent_admission_grants_exactly_one_permit() {
            let orchestrator = Arc::new(
                TranscodeOrchestrator::new(
                    Arc::new(FakeRenditionRepo::default()),
                    Arc::new(InMemory::new()),
                    ActiveSessionCounter::new(),
                )
                .with_max_concurrent_sessions(1),
            );
            let barrier = Arc::new(tokio::sync::Barrier::new(3));
            let attempts = (0..2)
                .map(|_| {
                    let orchestrator = orchestrator.clone();
                    let barrier = barrier.clone();
                    tokio::spawn(async move {
                        barrier.wait().await;
                        orchestrator.reserve_capacity(FULL_TRANSCODE_PERMITS).await
                    })
                })
                .collect::<Vec<_>>();

            barrier.wait().await;
            let [first, second] = attempts.try_into().expect("two admission attempts");
            let (first, second) = tokio::join!(first, second);
            let permits = [first.unwrap(), second.unwrap()];
            assert_eq!(permits.iter().filter(|result| result.is_ok()).count(), 1);
            assert_eq!(
                permits
                    .iter()
                    .filter(|result| matches!(result, Err(TranscodeError::NoCapacity)))
                    .count(),
                1
            );
            drop(permits);
            assert!(orchestrator
                .reserve_capacity(FULL_TRANSCODE_PERMITS)
                .await
                .is_ok());
        }

        #[cfg(unix)]
        #[tokio::test]
        async fn admission_permit_tracks_child_and_is_released_by_expiry() {
            let root = unique_tmp_dir();
            let sleeper = sleeping_ffmpeg(&root).await;

            let counter = ActiveSessionCounter::new();
            let orchestrator = TranscodeOrchestrator::new(
                Arc::new(FakeRenditionRepo::default()),
                Arc::new(InMemory::new()),
                counter.clone(),
            )
            .with_ffmpeg_binary(sleeper.to_string_lossy().into_owned())
            .with_output_root(root.join("output"))
            .with_max_concurrent_sessions(1);
            let media_file = sample_media_file();
            let first = orchestrator
                .spawn_on_demand_transcode(&media_file, "profile-a", "node-a")
                .await
                .expect("first child owns the only permit");

            assert!(matches!(
                orchestrator
                    .spawn_on_demand_transcode(&media_file, "profile-b", "node-a")
                    .await,
                Err(TranscodeError::NoCapacity)
            ));
            assert_eq!(counter.get(), 1);

            orchestrator.expire_session(first.id).await.unwrap();
            assert_eq!(counter.get(), 0);
            let second = orchestrator
                .spawn_on_demand_transcode(&media_file, "profile-c", "node-a")
                .await
                .expect("cleanup returns the permit");
            orchestrator.expire_session(second.id).await.unwrap();
            assert_eq!(counter.get(), 0);
        }

        #[cfg(unix)]
        async fn sleeper_orchestrator(slots: usize) -> TranscodeOrchestrator {
            let root = unique_tmp_dir();
            let sleeper = sleeping_ffmpeg(&root).await;
            TranscodeOrchestrator::new(
                Arc::new(FakeRenditionRepo::default()),
                Arc::new(InMemory::new()),
                ActiveSessionCounter::new(),
            )
            .with_ffmpeg_binary(sleeper.to_string_lossy().into_owned())
            .with_output_root(root.join("output"))
            .with_max_concurrent_sessions(slots)
        }

        #[cfg(unix)]
        #[tokio::test]
        async fn video_copy_takes_a_quarter_of_a_slot() {
            let orchestrator = sleeper_orchestrator(1).await;
            let media_file = sample_media_file();
            let copy = VideoCopy { hevc: false };
            let mut sessions = Vec::new();
            for _ in 0..PERMITS_PER_SLOT {
                sessions.push(
                    orchestrator
                        .spawn_video_copy_at_with_audio(
                            &media_file,
                            "p",
                            "n",
                            0,
                            None,
                            copy,
                            StreamHints::default(),
                        )
                        .await
                        .expect("a remux costs a quarter slot"),
                );
            }
            assert!(matches!(
                orchestrator
                    .spawn_video_copy_at_with_audio(
                        &media_file,
                        "p",
                        "n",
                        0,
                        None,
                        copy,
                        StreamHints::default()
                    )
                    .await,
                Err(TranscodeError::NoCapacity)
            ));
            // One quarter freed is still not enough for a full re-encode.
            orchestrator.expire_session(sessions[0].id).await.unwrap();
            assert!(matches!(
                orchestrator
                    .spawn_on_demand_transcode(&media_file, "p", "n")
                    .await,
                Err(TranscodeError::NoCapacity)
            ));
            for session in &sessions[1..] {
                orchestrator.expire_session(session.id).await.unwrap();
            }
            let full = orchestrator
                .spawn_on_demand_transcode(&media_file, "p", "n")
                .await
                .expect("an empty node takes a full re-encode");
            // A running full re-encode leaves no room for a remux.
            assert!(matches!(
                orchestrator
                    .spawn_video_copy_at_with_audio(
                        &media_file,
                        "p",
                        "n",
                        0,
                        None,
                        copy,
                        StreamHints::default()
                    )
                    .await,
                Err(TranscodeError::NoCapacity)
            ));
            orchestrator.expire_session(full.id).await.unwrap();
        }

        #[cfg(unix)]
        #[tokio::test]
        async fn borrowed_slot_never_changes_the_permit_pool() {
            let orchestrator = sleeper_orchestrator(1).await;
            let media_file = sample_media_file();
            let first = orchestrator
                .spawn_on_demand_transcode(&media_file, "p", "n")
                .await
                .unwrap();
            let borrowed = with_borrowed_admission(orchestrator.spawn_on_demand_transcode(
                &media_file,
                "q",
                "n",
            ))
            .await
            .expect("an admitted viewer may borrow one slot over the limit");
            assert_eq!(orchestrator.active_session_count(), 2);

            // Without the scope the full node still refuses.
            assert!(matches!(
                orchestrator
                    .spawn_on_demand_transcode(&media_file, "r", "n")
                    .await,
                Err(TranscodeError::NoCapacity)
            ));

            // Ending the borrowed one frees nothing (it held no permits): the first still holds the slot.
            orchestrator.expire_session(borrowed.id).await.unwrap();
            assert!(matches!(
                orchestrator
                    .spawn_on_demand_transcode(&media_file, "r", "n")
                    .await,
                Err(TranscodeError::NoCapacity)
            ));
            orchestrator.expire_session(first.id).await.unwrap();
            let again = orchestrator
                .spawn_on_demand_transcode(&media_file, "r", "n")
                .await
                .unwrap();
            assert!(matches!(
                orchestrator
                    .spawn_on_demand_transcode(&media_file, "s", "n")
                    .await,
                Err(TranscodeError::NoCapacity)
            ));
            orchestrator.expire_session(again.id).await.unwrap();
            // The pool is exactly what it started as: borrowing never grows it.
            assert_eq!(
                orchestrator.transcode_slots.available_permits(),
                PERMITS_PER_SLOT as usize
            );
        }

        #[cfg(unix)]
        #[tokio::test]
        async fn second_playback_session_attaches_and_the_last_one_stops_the_process() {
            let orchestrator = sleeper_orchestrator(1).await;
            let media_file = sample_media_file();
            let key = SharedTranscodeKey {
                user_id: Uuid::new_v4(),
                media_file_id: media_file.id,
                profile: "p".to_string(),
                audio_stream_index: None,
                start_position_ms: 5_000,
                video_copy: false,
                strip_dovi: false,
                max_audio_channels: None,
            };
            let (first_playback, second_playback) = (Uuid::new_v4(), Uuid::new_v4());
            let session = orchestrator
                .spawn_on_demand_transcode_at(&media_file, "p", "n", 5_000)
                .await
                .unwrap();
            orchestrator
                .register_shared_transcode(key.clone(), session.id)
                .await;
            orchestrator
                .associate_playback_session(first_playback, session.id)
                .await
                .unwrap();

            // The node is full, yet a second device attaches without a permit.
            let attached = orchestrator
                .find_shared_transcode(&key)
                .await
                .unwrap()
                .expect("a matching live transcode is shared");
            assert_eq!(attached.id, session.id);
            orchestrator
                .associate_playback_session(second_playback, attached.id)
                .await
                .unwrap();
            assert_eq!(orchestrator.active_session_count(), 1);

            // A different start position or account never attaches.
            let other_start = SharedTranscodeKey {
                start_position_ms: 0,
                ..key.clone()
            };
            let other_user = SharedTranscodeKey {
                user_id: Uuid::new_v4(),
                ..key.clone()
            };
            let other_channels = SharedTranscodeKey {
                max_audio_channels: Some(2),
                ..key.clone()
            };
            let other_strip = SharedTranscodeKey {
                strip_dovi: true,
                ..key.clone()
            };
            for other in [other_start, other_user, other_channels, other_strip] {
                assert!(orchestrator
                    .find_shared_transcode(&other)
                    .await
                    .unwrap()
                    .is_none());
            }

            // The first viewer leaving keeps the process for the second.
            orchestrator
                .expire_playback_session(first_playback)
                .await
                .unwrap();
            assert!(orchestrator
                .lookup_session(session.id)
                .await
                .unwrap()
                .is_some());
            assert_eq!(orchestrator.active_session_count(), 1);

            // The last viewer leaving stops it and frees the key.
            orchestrator
                .expire_playback_session(second_playback)
                .await
                .unwrap();
            assert!(orchestrator
                .lookup_session(session.id)
                .await
                .unwrap()
                .is_none());
            assert_eq!(orchestrator.active_session_count(), 0);
            assert!(orchestrator
                .find_shared_transcode(&key)
                .await
                .unwrap()
                .is_none());
        }

        #[cfg(unix)]
        #[tokio::test]
        async fn natural_child_exit_releases_capacity_but_keeps_session_until_expiry() {
            let root = unique_tmp_dir();
            let output_root = root.join("output");
            let counter = ActiveSessionCounter::new();
            let cache = Arc::new(InMemory::new());
            let orchestrator = TranscodeOrchestrator::new(
                Arc::new(FakeRenditionRepo::default()),
                cache.clone(),
                counter.clone(),
            )
            .with_ffmpeg_binary("/usr/bin/true")
            .with_output_root(output_root.clone())
            .with_max_concurrent_sessions(1);
            let media_file = sample_media_file();
            let first = orchestrator
                .spawn_on_demand_transcode(&media_file, "profile-a", "node-a")
                .await
                .expect("first child starts");
            let output_dir = output_root.join(first.id.to_string());
            assert!(output_dir.is_dir());

            tokio::time::sleep(Duration::from_millis(30)).await;
            orchestrator.reap_finished_children().await;
            assert_eq!(counter.get(), 0, "finished process released its slot");
            assert!(
                orchestrator
                    .lookup_session(first.id)
                    .await
                    .unwrap()
                    .is_some(),
                "the completed session remains available for playback"
            );
            assert!(
                output_dir.is_dir(),
                "completed output remains until cleanup"
            );

            let second = orchestrator
                .spawn_on_demand_transcode(&media_file, "profile-b", "node-a")
                .await
                .expect("natural child exit returned admission capacity");
            orchestrator.expire_session(second.id).await.unwrap();

            cache
                .delete(&TranscodeOrchestrator::session_cache_key(first.id))
                .await
                .unwrap();
            assert_eq!(orchestrator.reap_idle_sessions().await, 1);
            assert!(!output_dir.exists(), "TTL cleanup removes completed output");
            assert!(!orchestrator
                .active_children
                .lock()
                .await
                .contains_key(&first.id));
        }

        #[cfg(unix)]
        fn slot_orchestrator(
            ffmpeg: &str,
            output_root: PathBuf,
            cache: Arc<InMemory>,
            counter: ActiveSessionCounter,
        ) -> TranscodeOrchestrator {
            TranscodeOrchestrator::new(Arc::new(FakeRenditionRepo::default()), cache, counter)
                .with_ffmpeg_binary(ffmpeg)
                .with_output_root(output_root)
                .with_session_ttl(Duration::from_millis(150))
                .with_max_concurrent_sessions(1)
        }

        /// A browser killed mid-playback never sends a stop and never asks for
        /// another segment. The running idle reaper must hand the slot back
        /// within the idle TTL plus one reaper interval.
        #[cfg(unix)]
        #[tokio::test]
        async fn abandoned_client_frees_its_slot_within_the_idle_ttl() {
            let root = unique_tmp_dir();
            let sleeper = sleeping_ffmpeg(&root).await;
            let counter = ActiveSessionCounter::new();
            let orchestrator = Arc::new(slot_orchestrator(
                &sleeper.to_string_lossy(),
                root.join("output"),
                Arc::new(InMemory::new()),
                counter.clone(),
            ));
            let media_file = sample_media_file();
            let session = orchestrator
                .spawn_on_demand_transcode(&media_file, "profile-a", "node-a")
                .await
                .unwrap();
            let reaper = tokio::spawn(
                orchestrator
                    .clone()
                    .run_idle_reaper(Duration::from_millis(25)),
            );

            // The client keeps polling for a while: still held.
            for _ in 0..4 {
                tokio::time::sleep(Duration::from_millis(60)).await;
                assert!(orchestrator
                    .lookup_session(session.id)
                    .await
                    .unwrap()
                    .is_some());
            }
            assert!(matches!(
                orchestrator
                    .spawn_on_demand_transcode(&media_file, "profile-b", "node-a")
                    .await,
                Err(TranscodeError::NoCapacity)
            ));

            // The client disappears. Capacity must return in well under 2s.
            let deadline = tokio::time::Instant::now() + Duration::from_secs(2);
            let second = loop {
                match orchestrator
                    .spawn_on_demand_transcode(&media_file, "profile-b", "node-a")
                    .await
                {
                    Ok(session) => break session,
                    Err(TranscodeError::NoCapacity) if tokio::time::Instant::now() < deadline => {
                        tokio::time::sleep(Duration::from_millis(20)).await;
                    }
                    Err(error) => panic!("slot never came back: {error}"),
                }
            };
            assert_eq!(counter.get(), 1);
            assert!(orchestrator
                .lookup_session(session.id)
                .await
                .unwrap()
                .is_none());
            reaper.abort();
            orchestrator.expire_session(second.id).await.unwrap();
            assert_eq!(counter.get(), 0);
        }

        /// ffmpeg that fails straight away (bad input, missing codec) must not
        /// keep the slot while its session record lingers for the TTL.
        #[cfg(unix)]
        #[tokio::test]
        async fn failed_ffmpeg_frees_its_slot_immediately() {
            let root = unique_tmp_dir();
            let counter = ActiveSessionCounter::new();
            let orchestrator = slot_orchestrator(
                "/usr/bin/false",
                root.join("output"),
                Arc::new(InMemory::new()),
                counter.clone(),
            );
            let media_file = sample_media_file();
            orchestrator
                .spawn_on_demand_transcode(&media_file, "profile-a", "node-a")
                .await
                .unwrap();
            tokio::time::sleep(Duration::from_millis(40)).await;
            for profile in ["profile-b", "profile-c"] {
                let session = orchestrator
                    .spawn_on_demand_transcode(&media_file, profile, "node-a")
                    .await
                    .expect("a crashed ffmpeg must not hold the only slot");
                tokio::time::sleep(Duration::from_millis(40)).await;
                drop(session);
            }
            orchestrator.reap_finished_children().await;
            assert_eq!(counter.get(), 0);
        }

        /// Slots are node-local and in-memory: a restarted server starts with
        /// every slot free even though the shared cache still holds the dead
        /// process's session rows.
        #[cfg(unix)]
        #[tokio::test]
        async fn restart_starts_with_all_slots_free_despite_stale_cache_rows() {
            let root = unique_tmp_dir();
            let sleeper = sleeping_ffmpeg(&root).await;
            let cache = Arc::new(InMemory::new());
            let before = slot_orchestrator(
                &sleeper.to_string_lossy(),
                root.join("output"),
                cache.clone(),
                ActiveSessionCounter::new(),
            );
            let media_file = sample_media_file();
            let stale = before
                .spawn_on_demand_transcode(&media_file, "profile-a", "node-a")
                .await
                .unwrap();
            // Process exit: the orchestrator (and with `kill_on_drop` its
            // ffmpeg) goes away; the cache row survives.
            drop(before);

            let counter = ActiveSessionCounter::new();
            let after = slot_orchestrator(
                &sleeper.to_string_lossy(),
                root.join("output"),
                cache,
                counter.clone(),
            );
            assert_eq!(counter.get(), 0);
            let fresh = after
                .spawn_on_demand_transcode(&media_file, "profile-b", "node-a")
                .await
                .expect("a restarted node has every slot free");
            assert_ne!(fresh.id, stale.id);
            after.expire_session(fresh.id).await.unwrap();
            assert_eq!(counter.get(), 0);
        }

        /// Replacing a playback session's transcode hands the slot over.
        #[cfg(unix)]
        #[tokio::test]
        async fn superseded_session_releases_its_slot() {
            let root = unique_tmp_dir();
            let sleeper = sleeping_ffmpeg(&root).await;
            let counter = ActiveSessionCounter::new();
            let orchestrator = slot_orchestrator(
                &sleeper.to_string_lossy(),
                root.join("output"),
                Arc::new(InMemory::new()),
                counter.clone(),
            );
            let media_file = sample_media_file();
            let playback = Uuid::new_v4();
            let first = orchestrator
                .spawn_on_demand_transcode(&media_file, "profile-a", "node-a")
                .await
                .unwrap();
            orchestrator
                .associate_playback_session(playback, first.id)
                .await
                .unwrap();
            orchestrator
                .expire_playback_session(playback)
                .await
                .unwrap();
            assert_eq!(counter.get(), 0);
            let second = orchestrator
                .spawn_on_demand_transcode(&media_file, "profile-b", "node-a")
                .await
                .expect("slot returned by the stop");
            orchestrator
                .associate_playback_session(playback, second.id)
                .await
                .unwrap();
            orchestrator
                .expire_playback_session(playback)
                .await
                .unwrap();
            assert_eq!(counter.get(), 0);
        }

        #[tokio::test]
        async fn find_existing_rendition_delegates_to_the_repo() {
            let media_file_id = Uuid::new_v4();
            let repo = Arc::new(FakeRenditionRepo::with_ready(
                media_file_id,
                "h264-720p-4mbps",
            ));
            let orchestrator = test_orchestrator(repo);

            let found = orchestrator
                .find_existing_rendition(media_file_id, "h264-720p-4mbps")
                .await
                .unwrap();
            assert!(found.is_some());

            let missing = orchestrator
                .find_existing_rendition(media_file_id, "some-other-profile")
                .await
                .unwrap();
            assert!(missing.is_none());
        }

        /// Manual: `cargo test -p playarr-transcode detects_the_real_ffmpeg -- --ignored --nocapture`
        /// inside a memory scope; runs the real 4K chain benchmark with 4 threads.
        #[tokio::test]
        #[ignore]
        async fn detects_the_real_ffmpeg() {
            let env = DetectEnv {
                ffmpeg: "ffmpeg".into(),
                ffprobe: "ffprobe".into(),
                threads: 4,
                bench_dir: std::env::temp_dir().join("playarr-bench-test"),
            };
            let support = detect_tone_map_support(&env, |_| {}).await;
            eprintln!("{support:?}");
            assert!(support.zscale);
        }

        #[cfg(unix)]
        async fn script(dir: &Path, name: &str, body: &str) -> String {
            use std::os::unix::fs::PermissionsExt;
            let path = dir.join(name);
            tokio::fs::write(&path, format!("#!/bin/sh\n{body}\n"))
                .await
                .unwrap();
            let mut permissions = tokio::fs::metadata(&path).await.unwrap().permissions();
            permissions.set_mode(0o755);
            tokio::fs::set_permissions(&path, permissions)
                .await
                .unwrap();
            path.to_string_lossy().into_owned()
        }

        #[cfg(unix)]
        async fn bench_env(ffmpeg_body: &str, ffprobe_body: &str) -> DetectEnv {
            let root = unique_tmp_dir();
            tokio::fs::create_dir_all(&root).await.unwrap();
            DetectEnv {
                // The last argument is the output path, as ffmpeg takes it.
                ffmpeg: script(&root, "ffmpeg", ffmpeg_body).await,
                ffprobe: script(&root, "ffprobe", ffprobe_body).await,
                threads: 2,
                bench_dir: root.join("bench"),
            }
        }

        #[cfg(unix)]
        async fn leftovers(env: &DetectEnv) -> Vec<String> {
            let mut names = Vec::new();
            let mut dir = tokio::fs::read_dir(&env.bench_dir).await.unwrap();
            while let Some(entry) = dir.next_entry().await.unwrap() {
                names.push(entry.file_name().to_string_lossy().into_owned());
            }
            names
        }

        #[cfg(unix)]
        #[tokio::test]
        async fn a_generated_clip_is_verified_and_kept_in_the_bench_dir() {
            let env = bench_env(
                "for a; do last=$a; done; head -c 1100000 /dev/zero > \"$last\"",
                "echo 3840,2160,96",
            )
            .await;
            let clip = bench_clip(&env).await.expect("clip generated");
            assert_eq!(clip, env.bench_dir.join(BENCH_CLIP_NAME));
            assert_eq!(leftovers(&env).await, vec![BENCH_CLIP_NAME.to_string()]);
            // A valid clip is reused, not regenerated.
            assert_eq!(bench_clip(&env).await, Some(clip));
        }

        #[cfg(unix)]
        #[tokio::test]
        async fn a_wrong_or_failed_clip_is_never_used_and_leaves_no_partial_file() {
            // ffmpeg "succeeds" but the file is not 96 frames of 4K.
            let env = bench_env(
                "for a; do last=$a; done; head -c 1100000 /dev/zero > \"$last\"",
                "echo 1920,1080,10",
            )
            .await;
            assert_eq!(bench_clip(&env).await, None);
            assert!(leftovers(&env).await.is_empty());
            // ffmpeg writes a partial file and then fails.
            let env = bench_env(
                "for a; do last=$a; done; head -c 10 /dev/zero > \"$last\"; exit 1",
                "echo 3840,2160,96",
            )
            .await;
            assert_eq!(bench_clip(&env).await, None);
            assert!(leftovers(&env).await.is_empty());
        }

        #[cfg(unix)]
        #[tokio::test]
        async fn a_junk_file_at_the_clip_path_is_replaced_not_benchmarked() {
            // The file at the clip path is big enough but not the clip: it is deleted and regenerated.
            let env = bench_env(
                "for a; do last=$a; done; head -c 1100000 /dev/zero > \"$last\"",
                "case \"$*\" in *part*) echo 3840,2160,96;; *) echo 640,360,1;; esac",
            )
            .await;
            tokio::fs::create_dir_all(&env.bench_dir).await.unwrap();
            let path = env.bench_dir.join(BENCH_CLIP_NAME);
            tokio::fs::write(&path, vec![1u8; 1_100_000]).await.unwrap();
            assert_eq!(bench_clip(&env).await, Some(path.clone()));
            assert_eq!(leftovers(&env).await, vec![BENCH_CLIP_NAME.to_string()]);
        }

        #[cfg(unix)]
        #[tokio::test]
        async fn detection_never_blocks_a_request_that_does_not_need_it() {
            let orchestrator = test_orchestrator(Arc::new(FakeRenditionRepo::default()));
            // Nothing detected yet: the non-waiting answer is plain zscale with no RPU path.
            let support = orchestrator.tone_map_support_now();
            assert!(support.zscale && !support.libplacebo);
            assert_eq!(orchestrator.detect_runs.load(Ordering::SeqCst), 0);
        }

        /// While the (slow) benchmark runs, an HDR10 transcode must already respect a node whose
        /// ffmpeg has no zscale: the filter listing is stored before the benchmark starts.
        #[cfg(unix)]
        #[tokio::test]
        async fn the_filter_listing_is_used_before_the_benchmark_ends() {
            let root = unique_tmp_dir();
            tokio::fs::create_dir_all(&root).await.unwrap();
            // `-filters` lists libplacebo only (no zscale); the Vulkan check passes; clip generation hangs.
            let ffmpeg = script(
                &root,
                "ffmpeg",
                "case \"$*\" in\n*-filters*) echo ' .. libplacebo V->V x';;\n*vulkan*) exit 0;;\n*) sleep 20;;\nesac",
            )
            .await;
            let orchestrator = Arc::new(
                test_orchestrator(Arc::new(FakeRenditionRepo::default()))
                    .with_ffmpeg_binary(ffmpeg),
            );
            let running = orchestrator.clone();
            let detection = tokio::spawn(async move { running.tone_map_support().await });
            tokio::time::sleep(Duration::from_millis(800)).await;
            assert!(!detection.is_finished(), "the benchmark is still running");

            let support = orchestrator.tone_map_support_now();
            assert!(!support.zscale && !support.libplacebo);
            let hdr10 = video::parse_source_video(
                br#"{"streams":[{"pix_fmt":"yuv420p10le","color_transfer":"smpte2084"}]}"#,
            )
            .unwrap();
            let args = build_hls_args(
                Path::new("/media/in.mkv"),
                &TranscodeTargetProfile::resolve("h264-720p-4mbps"),
                Path::new("/tmp/s"),
                0,
                None,
                None,
                None,
                2,
                Some(&hdr10),
                support,
                StreamHints::default(),
            )
            .unwrap();
            let vf = args[args.iter().position(|a| a == "-vf").unwrap() + 1].clone();
            assert!(!vf.contains("zscale"), "{vf}");
            detection.abort();
        }

        /// Process state letter from /proc (`T` = stopped).
        #[cfg(target_os = "linux")]
        fn proc_state(pid: u32) -> char {
            std::fs::read_to_string(format!("/proc/{pid}/stat"))
                .ok()
                .and_then(|stat| {
                    stat.rsplit(')')
                        .next()
                        .and_then(|r| r.trim().chars().next())
                })
                .unwrap_or('?')
        }

        #[cfg(target_os = "linux")]
        async fn running_download(orchestrator: &TranscodeOrchestrator) -> DownloadJob {
            let reservation = orchestrator
                .reserve_download()
                .expect("an idle node admits a download");
            orchestrator
                .start_download(
                    reservation,
                    &sample_media_file_h264(),
                    "h264-480p-2mbps",
                    &unique_tmp_dir().join("d.mp4"),
                    &DownloadTracks::default(),
                )
                .await
                .expect("download starts")
        }

        fn sample_media_file_h264() -> MediaFile {
            MediaFile {
                codec: "h264".to_string(),
                ..sample_media_file()
            }
        }

        /// Live playback always wins on a one-slot node: a running download is paused, not refused.
        #[cfg(target_os = "linux")]
        #[tokio::test]
        async fn a_running_download_never_causes_no_capacity_for_live_playback() {
            let orchestrator = sleeper_orchestrator(1).await;
            let job = running_download(&orchestrator).await;
            let pid = job.handle.shared.pid.load(Ordering::SeqCst);
            assert_ne!(proc_state(pid), 'T');

            // The only slot is the download's, yet a viewer is admitted.
            let live = orchestrator
                .spawn_on_demand_transcode(&sample_media_file_h264(), "p", "n")
                .await
                .expect("live playback must not get NoCapacity because of a download");
            assert!(job.is_paused());
            // SIGSTOP is asynchronous: wait for the state to show.
            for _ in 0..50 {
                if proc_state(pid) == 'T' {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
            assert_eq!(
                proc_state(pid),
                'T',
                "the download is stopped while live runs"
            );
            // No resume while live playback holds the node.
            assert!(!job.try_resume().await);

            // Live ends: the download gets a slot back and continues.
            orchestrator.expire_session(live.id).await.unwrap();
            assert!(job.try_resume().await);
            for _ in 0..50 {
                if proc_state(pid) != 'T' {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
            assert_ne!(proc_state(pid), 'T');
            drop(job);
        }

        /// The reservation is preemptible from the moment it is taken, even while the download is
        /// still being set up (probing, claiming): live playback can always take the slot.
        #[cfg(target_os = "linux")]
        #[tokio::test]
        async fn a_download_still_being_set_up_yields_the_slot_to_live_playback() {
            let orchestrator = sleeper_orchestrator(1).await;
            let reservation = orchestrator.reserve_download().expect("idle node");
            assert!(!reservation.was_preempted());
            // No ffmpeg yet, and a viewer arrives: admitted, the reservation is preempted.
            let live = orchestrator
                .spawn_on_demand_transcode(&sample_media_file_h264(), "p", "n")
                .await
                .expect("live playback must take the slot");
            assert!(reservation.was_preempted());

            // The download then starts already stopped, and stays so while live runs.
            let job = orchestrator
                .start_download(
                    reservation,
                    &sample_media_file_h264(),
                    "h264-480p-2mbps",
                    &unique_tmp_dir().join("d.mp4"),
                    &DownloadTracks::default(),
                )
                .await
                .expect("download starts");
            let pid = job.handle.shared.pid.load(Ordering::SeqCst);
            for _ in 0..50 {
                if proc_state(pid) == 'T' {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
            assert_eq!(proc_state(pid), 'T');
            assert!(!job.try_resume().await);
            orchestrator.expire_session(live.id).await.unwrap();
            assert!(job.try_resume().await);
        }

        /// A finished download frees its registration at once: its pid is never signalled again and a
        /// new download can be admitted.
        #[cfg(unix)]
        #[tokio::test]
        async fn a_finished_download_clears_its_registration_when_wait_returns() {
            let orchestrator = test_orchestrator(Arc::new(FakeRenditionRepo::default()));
            let reservation = orchestrator.reserve_download().expect("idle");
            let mut job = orchestrator
                .start_download(
                    reservation,
                    &sample_media_file_h264(),
                    "h264-480p-2mbps",
                    &unique_tmp_dir().join("d.mp4"),
                    &DownloadTracks::default(),
                )
                .await
                .unwrap();
            assert!(job.wait().await, "/usr/bin/true succeeds");
            assert_eq!(job.handle.shared.pid.load(Ordering::SeqCst), 0);
            // The job value is still alive, yet the node already admits another download.
            assert!(
                orchestrator.reserve_download().is_ok()
                    || job.handle.shared.permit.lock().unwrap().is_some()
            );
        }

        #[tokio::test]
        async fn downloads_are_admitted_only_when_a_slot_stays_free_for_live_playback() {
            // One slot: only on a completely idle node.
            let one = test_orchestrator(Arc::new(FakeRenditionRepo::default()));
            let first = one.reserve_download().expect("idle node");
            assert!(matches!(
                one.reserve_download(),
                Err(TranscodeError::NoCapacity)
            ));
            drop(first);

            // Two slots: a spare slot must remain, so one download fits and a second does not.
            let two = test_orchestrator(Arc::new(FakeRenditionRepo::default()))
                .with_max_concurrent_sessions(2);
            let a = two.reserve_download().expect("two idle slots");
            assert!(matches!(
                two.reserve_download(),
                Err(TranscodeError::NoCapacity)
            ));
            drop(a);
            // A live session on one of two slots: no download (it would take the last one).
            let live = two
                .spawn_on_demand_transcode(&sample_media_file_h264(), "p", "n")
                .await;
            let _ = live;
            assert!(matches!(
                two.reserve_download(),
                Err(TranscodeError::NoCapacity)
            ));
        }

        /// A caller that gives up must neither cancel detection nor cause a second run.
        #[cfg(unix)]
        #[tokio::test]
        async fn a_dropped_first_caller_does_not_start_a_second_detection() {
            use std::os::unix::fs::PermissionsExt;
            let root = unique_tmp_dir();
            tokio::fs::create_dir_all(&root).await.unwrap();
            let slow = root.join("ffmpeg-slow-filters");
            tokio::fs::write(&slow, "#!/bin/sh\nsleep 1\nexit 0\n")
                .await
                .unwrap();
            let mut permissions = tokio::fs::metadata(&slow).await.unwrap().permissions();
            permissions.set_mode(0o755);
            tokio::fs::set_permissions(&slow, permissions)
                .await
                .unwrap();
            let orchestrator = test_orchestrator(Arc::new(FakeRenditionRepo::default()))
                .with_ffmpeg_binary(slow.to_string_lossy().into_owned());

            // The first caller gives up while detection runs (or, on a loaded machine, finishes).
            let _ =
                tokio::time::timeout(Duration::from_millis(100), orchestrator.tone_map_support())
                    .await;
            let support = orchestrator.tone_map_support().await;
            assert!(!support.libplacebo);
            assert_eq!(orchestrator.detect_runs.load(Ordering::SeqCst), 1);
            // The result is kept: no third run for a settled answer within the retry window.
            orchestrator.tone_map_support().await;
            assert_eq!(orchestrator.detect_runs.load(Ordering::SeqCst), 1);
        }

        /// An old negative answer is returned at once while a refresh runs in the background.
        #[cfg(unix)]
        #[tokio::test]
        async fn a_stale_negative_result_is_served_while_the_refresh_runs() {
            use std::os::unix::fs::PermissionsExt;
            let root = unique_tmp_dir();
            tokio::fs::create_dir_all(&root).await.unwrap();
            let slow = root.join("ffmpeg-slow-refresh");
            tokio::fs::write(&slow, "#!/bin/sh\nsleep 1\nexit 0\n")
                .await
                .unwrap();
            let mut permissions = tokio::fs::metadata(&slow).await.unwrap().permissions();
            permissions.set_mode(0o755);
            tokio::fs::set_permissions(&slow, permissions)
                .await
                .unwrap();
            let orchestrator = test_orchestrator(Arc::new(FakeRenditionRepo::default()))
                .with_ffmpeg_binary(slow.to_string_lossy().into_owned());
            orchestrator.detect.lock().unwrap().done = Some((
                video::ToneMapSupport {
                    zscale: true,
                    libplacebo: false,
                    libplacebo_fps: None,
                },
                std::time::Instant::now() - DETECT_RETRY_TTL - Duration::from_secs(1),
            ));
            let started = std::time::Instant::now();
            let support = orchestrator.tone_map_support().await;
            assert!(
                started.elapsed() < Duration::from_millis(500),
                "must not wait for the refresh"
            );
            assert!(support.zscale);
            assert_eq!(orchestrator.detect_runs.load(Ordering::SeqCst), 1);
        }

        #[tokio::test]
        async fn on_demand_renditions_from_before_tone_mapping_are_not_reused() {
            let media_file_id = Uuid::new_v4();
            let repo = Arc::new(FakeRenditionRepo::with_ready(media_file_id, "p"));
            for r in repo.renditions.lock().unwrap().values_mut() {
                r.produced_by = ProducedBy::OnDemand;
                r.produced_at = *TONE_MAP_EPOCH - chrono::Duration::days(1);
            }
            let orchestrator = test_orchestrator(repo.clone());
            assert!(orchestrator
                .find_existing_rendition(media_file_id, "p")
                .await
                .unwrap()
                .is_none());
            for r in repo.renditions.lock().unwrap().values_mut() {
                r.produced_at = *TONE_MAP_EPOCH + chrono::Duration::hours(1);
            }
            assert!(orchestrator
                .find_existing_rendition(media_file_id, "p")
                .await
                .unwrap()
                .is_some());
        }
    }

    // ---- TdarrDispatcher -----------------------------------------------

    mod tdarr_dispatcher {
        use super::*;
        use wiremock::matchers::{body_json, method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        fn test_config() -> TdarrDispatcherConfig {
            TdarrDispatcherConfig {
                tdarr_db_id: "db-1".to_string(),
                default_profile: "h264-720p-4mbps".to_string(),
                worker_process: "transcodecpu".to_string(),
                default_worker_limit: 2,
                throttled_worker_limit: 0,
                active_session_threshold: 2,
                throttle_check_interval: Duration::from_millis(50),
            }
        }

        #[tokio::test]
        async fn dispatch_skips_tdarr_when_ready_rendition_already_exists() {
            // No mocks mounted: if `dispatch_one` calls Tdarr at all, the
            // request 404s and `dispatch_one` returns an `Err`, failing the
            // `.unwrap()` below — proving the ready-rendition guard
            // short-circuits before any HTTP call.
            let mock_server = MockServer::start().await;

            let media_file = sample_media_file();
            let repo = Arc::new(FakeRenditionRepo::with_ready(
                media_file.id,
                "h264-720p-4mbps",
            ));
            let tdarr = TdarrClient::new(mock_server.uri(), "test-api-key");
            let (_tx, events_rx) = mpsc::channel(1);

            let dispatcher = TdarrDispatcher::new(
                tdarr,
                repo,
                ActiveSessionCounter::new(),
                events_rx,
                test_config(),
            );

            dispatcher.dispatch_one(&media_file).await.unwrap();
        }

        #[tokio::test]
        async fn dispatch_calls_scan_individual_file_when_no_ready_rendition() {
            let mock_server = MockServer::start().await;
            Mock::given(method("POST"))
                .and(path("/api/v2/scan-individual-file"))
                .respond_with(
                    ResponseTemplate::new(200)
                        .set_body_json(serde_json::json!({ "status": "queued" })),
                )
                .expect(1)
                .mount(&mock_server)
                .await;

            let media_file = sample_media_file();
            let repo = Arc::new(FakeRenditionRepo::default());
            let tdarr = TdarrClient::new(mock_server.uri(), "test-api-key");
            let (_tx, events_rx) = mpsc::channel(1);

            let dispatcher = TdarrDispatcher::new(
                tdarr,
                repo,
                ActiveSessionCounter::new(),
                events_rx,
                test_config(),
            );

            dispatcher.dispatch_one(&media_file).await.unwrap();

            mock_server.verify().await;
        }

        #[tokio::test]
        async fn throttle_lowers_worker_limit_once_session_count_hits_threshold() {
            let mock_server = MockServer::start().await;
            Mock::given(method("GET"))
                .and(path("/api/v2/get-nodes"))
                .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([
                    { "nodeID": "node-1", "nodeName": "worker-1", "workers": {} }
                ])))
                .mount(&mock_server)
                .await;

            Mock::given(method("POST"))
                .and(path("/api/v2/alter-worker-limit"))
                .and(body_json(serde_json::json!({
                    "nodeID": "node-1",
                    "process": "transcodecpu",
                    "worker_limit": 0
                })))
                .respond_with(ResponseTemplate::new(200))
                .expect(1)
                .mount(&mock_server)
                .await;

            let repo = Arc::new(FakeRenditionRepo::default());
            let tdarr = TdarrClient::new(mock_server.uri(), "test-api-key");
            let counter = ActiveSessionCounter::new();
            counter.increment();
            counter.increment();
            let (_tx, events_rx) = mpsc::channel(1);

            let dispatcher = TdarrDispatcher::new(tdarr, repo, counter, events_rx, test_config());

            dispatcher.check_and_apply_throttle().await.unwrap();

            mock_server.verify().await;
        }

        #[tokio::test]
        async fn throttle_keeps_default_worker_limit_below_threshold() {
            let mock_server = MockServer::start().await;
            Mock::given(method("GET"))
                .and(path("/api/v2/get-nodes"))
                .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([
                    { "nodeID": "node-1", "nodeName": "worker-1", "workers": {} }
                ])))
                .mount(&mock_server)
                .await;

            Mock::given(method("POST"))
                .and(path("/api/v2/alter-worker-limit"))
                .and(body_json(serde_json::json!({
                    "nodeID": "node-1",
                    "process": "transcodecpu",
                    "worker_limit": 2
                })))
                .respond_with(ResponseTemplate::new(200))
                .expect(1)
                .mount(&mock_server)
                .await;

            let repo = Arc::new(FakeRenditionRepo::default());
            let tdarr = TdarrClient::new(mock_server.uri(), "test-api-key");
            // Below `active_session_threshold` (2) from `test_config`.
            let counter = ActiveSessionCounter::new();
            counter.increment();
            let (_tx, events_rx) = mpsc::channel(1);

            let dispatcher = TdarrDispatcher::new(tdarr, repo, counter, events_rx, test_config());

            dispatcher.check_and_apply_throttle().await.unwrap();

            mock_server.verify().await;
        }

        #[tokio::test]
        async fn run_dispatches_incoming_events_then_exits_when_channel_closes() {
            let mock_server = MockServer::start().await;
            Mock::given(method("POST"))
                .and(path("/api/v2/scan-individual-file"))
                .respond_with(
                    ResponseTemplate::new(200)
                        .set_body_json(serde_json::json!({ "status": "queued" })),
                )
                .expect(1)
                .mount(&mock_server)
                .await;

            let media_file = sample_media_file();
            let repo = Arc::new(FakeRenditionRepo::default());
            let tdarr = TdarrClient::new(mock_server.uri(), "test-api-key");

            let mut config = test_config();
            // Long enough that the throttle branch never fires during this
            // test — it's exercised separately above.
            config.throttle_check_interval = Duration::from_secs(3600);

            let (tx, events_rx) = mpsc::channel(1);
            let dispatcher =
                TdarrDispatcher::new(tdarr, repo, ActiveSessionCounter::new(), events_rx, config);

            let handle = tokio::spawn(dispatcher.run());

            tx.send(MediaFileImportEvent {
                media_file: media_file.clone(),
            })
            .await
            .unwrap();
            drop(tx);

            let result = tokio::time::timeout(Duration::from_secs(5), handle).await;
            assert!(
                result.is_ok(),
                "dispatcher.run() should exit once the event channel closes"
            );
            assert!(result.unwrap().unwrap().is_ok());

            mock_server.verify().await;
        }
    }
}
