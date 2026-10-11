//! What this device can really decode and show, sent with every playback negotiation
//! (see the server's `GET /api/v1/playback/{id}` capability query). Detection reads the GStreamer registry;
//! values stay conservative where the platform cannot answer: the screen is treated as SDR, 8-bit, stereo.
use gstreamer as gst;

/// Decoders GStreamer can use for each codec, any one is enough.
const VIDEO: [(&str, &[&str]); 4] = [
    (
        "h264",
        &[
            "avdec_h264",
            "openh264dec",
            "v4l2slh264dec",
            "vah264dec",
            "vaapih264dec",
        ],
    ),
    ("hevc", &["avdec_h265", "v4l2slh265dec", "vah265dec", "vaapih265dec"]),
    ("av1", &["dav1ddec", "av1dec", "vaav1dec"]),
    ("vp9", &["vp9dec", "avdec_vp9", "v4l2slvp9dec", "vavp9dec"]),
];

#[derive(Debug, Clone, PartialEq)]
pub struct Caps {
    pub video_codecs: Vec<&'static str>,
    /// Deepest colour the display path renders; the GL sink converts to 8-bit.
    pub max_bit_depth: u8,
    /// HDR formats the display shows. Empty: the server tone-maps.
    pub hdr: Vec<&'static str>,
    pub dv_profiles: Vec<u8>,
    pub max_channels: u8,
    /// Largest picture decoded in real time: Full HD when only software decoders exist (a phone CPU cannot keep up with 4K).
    pub max_width: u32,
    pub max_height: u32,
}

impl Caps {
    /// Capabilities from a list of decoder factories that are present.
    pub fn from_decoders(has: impl Fn(&str) -> bool) -> Caps {
        let hardware = VIDEO
            .iter()
            .flat_map(|(_, n)| n.iter())
            .any(|n| (n.starts_with("v4l2sl") || n.starts_with("va")) && has(n));
        let video_codecs: Vec<&'static str> = VIDEO
            .iter()
            .filter(|(_, names)| names.iter().any(|n| has(n)))
            .map(|(c, _)| *c)
            .collect();
        Caps {
            video_codecs: if video_codecs.is_empty() {
                vec!["h264"]
            } else {
                video_codecs
            },
            max_bit_depth: 8,
            hdr: Vec::new(),
            dv_profiles: Vec::new(),
            max_channels: 2,
            max_width: if hardware { 3840 } else { 1920 },
            max_height: if hardware { 2160 } else { 1080 },
        }
    }

    pub fn detect() -> Caps {
        let _ = gst::init();
        Caps::from_decoders(|n| gst::ElementFactory::find(n).is_some())
    }

    /// Query string tail for the playback request. The force flags only appear when switched on.
    pub fn query(&self, force_direct_video: bool, force_direct_audio: bool) -> String {
        let mut q = format!(
            "containers=mp4,mov&video_codecs={}&audio_codecs=aac,mp3&hdr={}&max_bit_depth={}&max_channels={}&max_width={}&max_height={}",
            self.video_codecs.join(","),
            self.hdr.join(","),
            self.max_bit_depth,
            self.max_channels,
            self.max_width,
            self.max_height
        );
        if !self.dv_profiles.is_empty() {
            let dv: Vec<String> = self.dv_profiles.iter().map(|p| p.to_string()).collect();
            q.push_str(&format!("&dv_profiles={}", dv.join(",")));
        }
        if force_direct_video {
            q.push_str("&force_direct_video=true");
        }
        if force_direct_audio {
            q.push_str("&force_direct_audio=true");
        }
        q
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn declares_only_decoders_that_exist() {
        let c = Caps::from_decoders(|n| n == "avdec_h264" || n == "dav1ddec");
        assert_eq!(c.video_codecs, ["h264", "av1"]);
        assert_eq!(
            Caps::from_decoders(|_| false).video_codecs,
            ["h264"],
            "falls back to the baseline"
        );
    }

    #[test]
    fn sdr_display_sends_empty_hdr_with_bit_depth() {
        let q = Caps::from_decoders(|n| n == "avdec_h264").query(false, false);
        assert!(
            q.contains("&hdr=&max_bit_depth=8&max_channels=2&max_width=1920&max_height=1080"),
            "{q}"
        );
        assert!(
            !q.contains("dv_profiles"),
            "DV profiles only when the display renders them"
        );
    }

    #[test]
    fn dv5_listed_only_when_declared() {
        let mut c = Caps::from_decoders(|_| true);
        c.hdr = vec!["hdr10", "dolby_vision"];
        c.dv_profiles = vec![5, 8];
        let q = c.query(false, false);
        assert!(
            q.contains("hdr=hdr10,dolby_vision") && q.contains("dv_profiles=5,8"),
            "{q}"
        );
    }

    #[test]
    fn force_flags_map_to_params_only_when_on() {
        let c = Caps::from_decoders(|_| true);
        assert!(!c.query(false, false).contains("force_direct"));
        assert!(
            c.query(true, false).contains("force_direct_video=true")
                && !c.query(true, false).contains("force_direct_audio")
        );
        assert!(c.query(false, true).contains("force_direct_audio=true"));
    }
}
