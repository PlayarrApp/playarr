//! Persisted session and settings, JSON files in the XDG data directory (mode 0600).
//! shortcut: tokens sit in a user-only file, not libsecret; upgrade when the device keyring is reliable on Phosh.
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct Session {
    pub server_url: String,
    pub access_token: String,
    pub refresh_token: String,
    pub device_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Settings {
    /// "dark" (default), "light" or "system".
    pub theme: String,
    /// Advanced player settings: skip transcoding of that stream (default off, stored per device).
    #[serde(default)]
    pub force_direct_video: bool,
    #[serde(default)]
    pub force_direct_audio: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            theme: "dark".into(),
            force_direct_video: false,
            force_direct_audio: false,
        }
    }
}

pub fn data_dir() -> PathBuf {
    let base = std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local/share")))
        .unwrap_or_else(|| PathBuf::from("."));
    base.join("playarr-mobile")
}

pub fn cache_dir() -> PathBuf {
    let base = std::env::var_os("XDG_CACHE_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".cache")))
        .unwrap_or_else(|| PathBuf::from("."));
    base.join("playarr-mobile")
}

fn write_private(path: &std::path::Path, text: &str) -> std::io::Result<()> {
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension("tmp");
    let mut f = std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(&tmp)?;
    f.write_all(text.as_bytes())?;
    f.sync_all()?;
    std::fs::rename(tmp, path)
}

fn load<T: for<'de> Deserialize<'de>>(name: &str) -> Option<T> {
    serde_json::from_str(&std::fs::read_to_string(data_dir().join(name)).ok()?).ok()
}

fn save<T: Serialize>(name: &str, value: &T) {
    if let Ok(text) = serde_json::to_string_pretty(value) {
        let _ = write_private(&data_dir().join(name), &text);
    }
}

pub fn load_session() -> Option<Session> {
    load::<Session>("session.json").filter(|s| !s.access_token.is_empty() && !s.server_url.is_empty())
}
pub fn save_session(s: &Session) {
    save("session.json", s)
}
pub fn clear_session() {
    let _ = std::fs::remove_file(data_dir().join("session.json"));
}
pub fn load_settings() -> Settings {
    load("settings.json").unwrap_or_default()
}
pub fn save_settings(s: &Settings) {
    save("settings.json", s)
}
/// Loads the settings, applies `change`, saves them.
pub fn update_settings(change: impl FnOnce(&mut Settings)) {
    let mut s = load_settings();
    change(&mut s);
    save_settings(&s);
}

/// Random UUID v4 from the kernel, used as the refresh `device_id` when the token carries none.
pub fn new_device_id() -> String {
    use std::io::Read;
    let mut b = [0u8; 16];
    if let Ok(mut f) = std::fs::File::open("/dev/urandom") {
        let _ = f.read_exact(&mut b);
    }
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    let h: Vec<String> = b.iter().map(|x| format!("{x:02x}")).collect();
    let h = h.concat();
    format!("{}-{}-{}-{}-{}", &h[..8], &h[8..12], &h[12..16], &h[16..20], &h[20..])
}

/// Reads a string claim from an unverified JWT payload (the server verifies the token on every call).
pub fn jwt_claim(token: &str, claim: &str) -> Option<String> {
    let seg = token.split('.').nth(1)?;
    let bytes = b64url_decode(seg)?;
    let v: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    v.get(claim)?.as_str().map(str::to_string)
}

fn b64url_decode(s: &str) -> Option<Vec<u8>> {
    let mut out = Vec::new();
    let (mut acc, mut bits) = (0u32, 0u32);
    for c in s.bytes() {
        let v = match c {
            b'A'..=b'Z' => c - b'A',
            b'a'..=b'z' => c - b'a' + 26,
            b'0'..=b'9' => c - b'0' + 52,
            b'-' | b'+' => 62,
            b'_' | b'/' => 63,
            b'=' => break,
            _ => return None,
        } as u32;
        acc = (acc << 6) | v;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((acc >> bits) as u8);
            acc &= (1 << bits) - 1;
        }
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_default_off_and_old_files_load() {
        let s: Settings = serde_json::from_str(r#"{"theme":"light"}"#).unwrap();
        assert_eq!(s.theme, "light");
        assert!(!s.force_direct_video && !s.force_direct_audio);
        assert!(!Settings::default().force_direct_video);
    }

    #[test]
    fn device_id_is_v4_uuid() {
        let id = new_device_id();
        assert_eq!(id.len(), 36);
        assert_eq!(&id[14..15], "4");
    }

    #[test]
    fn jwt_claim_reads_payload() {
        // header.{"device_id":"abc","sub":"u1"}.sig
        let payload = "eyJkZXZpY2VfaWQiOiJhYmMiLCJzdWIiOiJ1MSJ9";
        let t = format!("h.{payload}.s");
        assert_eq!(jwt_claim(&t, "device_id").as_deref(), Some("abc"));
        assert_eq!(jwt_claim(&t, "sub").as_deref(), Some("u1"));
        assert_eq!(jwt_claim("nope", "sub"), None);
    }
}
