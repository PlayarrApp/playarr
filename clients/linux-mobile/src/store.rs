//! Persisted session and settings, JSON files in the XDG data directory (mode 0600).
//! shortcut: tokens sit in a user-only file, not libsecret; upgrade when the device keyring is reliable on Phosh.
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

static PROFILE_STORE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct Session {
    pub server_url: String,
    pub access_token: String,
    pub refresh_token: String,
    pub device_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
struct SessionFile {
    #[serde(default)]
    active_key: Option<String>,
    #[serde(default)]
    sessions: BTreeMap<String, Session>,
}

#[derive(Debug, Clone)]
pub struct StoreError(String);

impl std::fmt::Display for StoreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for StoreError {}

impl From<std::io::Error> for StoreError {
    fn from(error: std::io::Error) -> Self {
        Self(error.to_string())
    }
}

impl From<serde_json::Error> for StoreError {
    fn from(error: serde_json::Error) -> Self {
        Self(error.to_string())
    }
}

/// Atomic v2 profile-session store. Legacy `session.json` is read only when
/// `sessions.json` does not exist, and is retained after a successful migration.
#[derive(Debug, Clone)]
pub struct ProfileSessionStore {
    dir: PathBuf,
}

impl ProfileSessionStore {
    pub fn new(dir: impl Into<PathBuf>) -> Self {
        Self { dir: dir.into() }
    }

    fn sessions_path(&self) -> PathBuf {
        self.dir.join("sessions.json")
    }

    fn lock(&self) -> Result<MutexGuard<'static, ()>, StoreError> {
        PROFILE_STORE_LOCK
            .lock()
            .map_err(|_| StoreError("profile session store lock is unavailable".into()))
    }

    fn read(&self) -> Result<SessionFile, StoreError> {
        let path = self.sessions_path();
        if path.try_exists()? {
            let file: SessionFile = serde_json::from_slice(&std::fs::read(path)?)?;
            for (key, session) in &file.sessions {
                if session_key(session)? != *key {
                    return Err(StoreError("session key does not match its profile credentials".into()));
                }
            }
            if file
                .active_key
                .as_ref()
                .is_some_and(|key| !file.sessions.contains_key(key))
            {
                return Err(StoreError("active session key is missing from session store".into()));
            }
            return Ok(file);
        }

        let legacy = self.dir.join("session.json");
        if !legacy.try_exists()? {
            return Ok(SessionFile::default());
        }
        let session: Session = serde_json::from_slice(&std::fs::read(legacy)?)?;
        let key = session_key(&session)?;
        let mut file = SessionFile::default();
        file.sessions.insert(key.clone(), session);
        file.active_key = Some(key);
        self.write(&file)?;
        Ok(file)
    }

    fn write(&self, file: &SessionFile) -> Result<(), StoreError> {
        let text = serde_json::to_vec_pretty(file)?;
        let path = self.sessions_path();
        std::fs::create_dir_all(&self.dir)?;
        write_private_atomic(&path, &text)?;
        Ok(())
    }

    pub fn active(&self) -> Result<Option<Session>, StoreError> {
        let _guard = self.lock()?;
        let file = self.read()?;
        Ok(file.active_key.and_then(|key| file.sessions.get(&key).cloned()))
    }

    pub fn get(&self, base_url: &str, user_id: &str) -> Result<Option<Session>, StoreError> {
        let _guard = self.lock()?;
        let key = profile_key(base_url, user_id)?;
        Ok(self.read()?.sessions.get(&key).cloned())
    }

    pub fn contains(&self, session: &Session) -> Result<bool, StoreError> {
        let key = session_key(session)?;
        let _guard = self.lock()?;
        Ok(self.read()?.sessions.contains_key(&key))
    }

    pub fn for_session(&self, session: &Session) -> Result<Option<Session>, StoreError> {
        let key = session_key(session)?;
        let _guard = self.lock()?;
        Ok(self.read()?.sessions.get(&key).cloned())
    }

    /// Updates credentials only if that exact profile already exists in v2 storage.
    pub fn update_existing(&self, session: &Session) -> Result<bool, StoreError> {
        let _guard = self.lock()?;
        let key = session_key(session)?;
        let mut file = self.read()?;
        if !file.sessions.contains_key(&key) {
            return Ok(false);
        }
        file.sessions.insert(key, session.clone());
        self.write(&file)?;
        Ok(true)
    }

    pub fn is_saved(&self, base_url: &str, user_id: &str) -> Result<bool, StoreError> {
        Ok(self.get(base_url, user_id)?.is_some())
    }

    /// Persists credentials without changing which profile is active.
    pub fn save_inactive(&self, session: &Session) -> Result<(), StoreError> {
        let _guard = self.lock()?;
        let key = session_key(session)?;
        let mut file = self.read()?;
        file.sessions.insert(key, session.clone());
        self.write(&file)
    }

    /// Stores an initial link/login session as the active profile.
    pub fn save_active(&self, session: &Session) -> Result<(), StoreError> {
        let _guard = self.lock()?;
        let key = session_key(session)?;
        let mut file = self.read()?;
        file.sessions.insert(key.clone(), session.clone());
        file.active_key = Some(key);
        self.write(&file)
    }

    /// Activates a previously persisted session only after its credentials have been validated.
    pub fn activate(&self, session: &Session) -> Result<(), StoreError> {
        let _guard = self.lock()?;
        let key = session_key(session)?;
        let mut file = self.read()?;
        file.sessions.insert(key.clone(), session.clone());
        self.write(&file)?;
        file.active_key = Some(key);
        self.write(&file)
    }

    /// Stores validated target credentials before changing the active key, and only
    /// activates while the expected outgoing profile remains active.
    pub fn activate_if_active(
        &self,
        session: &Session,
        expected_active: &Session,
        still_valid: impl FnOnce() -> bool,
    ) -> Result<bool, StoreError> {
        let _guard = self.lock()?;
        let target_key = session_key(session)?;
        let expected_key = session_key(expected_active)?;
        let mut file = self.read()?;
        if file.active_key.as_deref() != Some(expected_key.as_str()) {
            return Ok(false);
        }
        file.sessions.insert(target_key.clone(), session.clone());
        self.write(&file)?;
        if !still_valid() {
            return Ok(false);
        }
        let mut current = self.read()?;
        if current.active_key.as_deref() != Some(expected_key.as_str()) {
            return Ok(false);
        }
        current.active_key = Some(target_key);
        self.write(&current)?;
        Ok(true)
    }

    /// Removes only the active session. An empty v2 file prevents legacy resurrection.
    pub fn remove_active(&self) -> Result<(), StoreError> {
        let _guard = self.lock()?;
        let mut file = self.read()?;
        if let Some(key) = file.active_key.take() {
            file.sessions.remove(&key);
        }
        self.write(&file)
    }
}

fn session_key(session: &Session) -> Result<String, StoreError> {
    let user_id = jwt_claim(&session.access_token, "sub")
        .filter(|value| !value.is_empty())
        .ok_or_else(|| StoreError("session access token has no profile subject".into()))?;
    profile_key(&session.server_url, &user_id)
}

pub fn profile_key(base_url: &str, user_id: &str) -> Result<String, StoreError> {
    let base = normalize_base_url(base_url)?;
    if user_id.is_empty() {
        return Err(StoreError("profile subject is empty".into()));
    }
    Ok(format!("{}:{base}{user_id}", base.len()))
}

fn normalize_base_url(input: &str) -> Result<String, StoreError> {
    let input = input.trim();
    let (scheme, rest) = input
        .split_once("://")
        .ok_or_else(|| StoreError("server URL must include http:// or https://".into()))?;
    let scheme = scheme.to_ascii_lowercase();
    if scheme != "http" && scheme != "https" {
        return Err(StoreError("server URL must use HTTP or HTTPS".into()));
    }
    let authority_end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    let authority = &rest[..authority_end];
    if authority.is_empty() || authority.contains('@') {
        return Err(StoreError("server URL has an invalid authority".into()));
    }
    let mut path = &rest[authority_end..];
    if path.contains('?') || path.contains('#') {
        return Err(StoreError("server URL must not include a query or fragment".into()));
    }
    while path.ends_with('/') && !path.is_empty() {
        path = &path[..path.len() - 1];
    }
    let authority = authority.to_ascii_lowercase();
    let normalized = match (scheme.as_str(), authority.as_str()) {
        ("http", host) if host.ends_with(":80") => host.trim_end_matches(":80"),
        ("https", host) if host.ends_with(":443") => host.trim_end_matches(":443"),
        _ => &authority,
    };
    Ok(format!("{scheme}://{normalized}{path}"))
}

fn write_private_atomic(path: &Path, bytes: &[u8]) -> Result<(), StoreError> {
    use std::io::Write;
    use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
    let tmp = path.with_extension("json.tmp");
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(&tmp)?;
    file.set_permissions(std::fs::Permissions::from_mode(0o600))?;
    file.write_all(bytes)?;
    file.sync_all()?;
    drop(file);
    std::fs::rename(&tmp, path)?;
    std::fs::File::open(path.parent().unwrap_or_else(|| Path::new(".")))?.sync_all()?;
    Ok(())
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
    /// Home screen artwork: portrait covers instead of wide thumbnails (Settings > Appearance).
    #[serde(default)]
    pub home_cover: bool,
    /// Artwork size: "small", "medium" (default) or "large".
    #[serde(default = "default_artwork_size")]
    pub artwork_size: String,
}

fn default_artwork_size() -> String {
    "medium".into()
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            theme: "dark".into(),
            force_direct_video: false,
            force_direct_audio: false,
            home_cover: false,
            artwork_size: default_artwork_size(),
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

fn profile_session_store() -> ProfileSessionStore {
    ProfileSessionStore::new(data_dir())
}

pub fn load_session() -> Result<Option<Session>, StoreError> {
    profile_session_store().active()
}

pub fn save_session(s: &Session) -> Result<(), StoreError> {
    profile_session_store().save_active(s)
}

pub fn save_inactive_session(s: &Session) -> Result<(), StoreError> {
    profile_session_store().save_inactive(s)
}

pub fn activate_session(s: &Session) -> Result<(), StoreError> {
    profile_session_store().activate(s)
}

pub fn remove_active_session() -> Result<(), StoreError> {
    profile_session_store().remove_active()
}

pub fn saved_session(server_url: &str, user_id: &str) -> Result<Option<Session>, StoreError> {
    profile_session_store().get(server_url, user_id)
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
    use std::sync::atomic::{AtomicU64, Ordering};

    static NEXT_DIR: AtomicU64 = AtomicU64::new(0);

    fn temp_dir() -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "playarr-session-store-{}-{}",
            std::process::id(),
            NEXT_DIR.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    fn session(server_url: &str, user: &str, access: &str) -> Session {
        let payload = match user {
            "u1" => "eyJzdWIiOiJ1MSJ9",
            "u2" => "eyJzdWIiOiJ1MiJ9",
            _ => panic!("add a fixed test payload"),
        };
        Session {
            server_url: server_url.into(),
            access_token: format!("h.{payload}.{access}"),
            refresh_token: format!("refresh-{user}"),
            device_id: format!("device-{user}"),
        }
    }

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

    #[test]
    fn profile_key_normalizes_host_and_trailing_slash_but_keeps_path_prefix() {
        let first = profile_key("HTTPS://Example.COM:443/tenant/playarr/", "u1").unwrap();
        let same = profile_key("https://example.com/tenant/playarr", "u1").unwrap();
        let other_path = profile_key("https://example.com/other/tenant", "u1").unwrap();
        assert_eq!(first, same);
        assert_ne!(first, other_path);
    }

    #[test]
    fn legacy_migration_is_durable_private_and_retains_legacy_file() {
        use std::os::unix::fs::PermissionsExt;
        let dir = temp_dir();
        let legacy = session("https://example.test/prefix", "u1", "sig");
        std::fs::write(dir.join("session.json"), serde_json::to_vec(&legacy).unwrap()).unwrap();

        let store = ProfileSessionStore::new(&dir);
        assert_eq!(store.active().unwrap(), Some(legacy.clone()));
        let metadata = std::fs::metadata(dir.join("sessions.json")).unwrap();
        assert_eq!(metadata.permissions().mode() & 0o777, 0o600);
        assert!(dir.join("session.json").exists());
        assert_eq!(store.active().unwrap(), Some(legacy));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn existing_v2_store_prevents_legacy_fallback_after_signout() {
        let dir = temp_dir();
        let legacy = session("https://example.test", "u1", "sig");
        std::fs::write(dir.join("session.json"), serde_json::to_vec(&legacy).unwrap()).unwrap();
        let store = ProfileSessionStore::new(&dir);
        assert_eq!(store.active().unwrap(), Some(legacy));
        store.remove_active().unwrap();
        assert!(store.active().unwrap().is_none());
        assert!(dir.join("session.json").exists());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn corrupt_existing_v2_store_does_not_resurrect_legacy_session() {
        let dir = temp_dir();
        let legacy = session("https://example.test", "u1", "sig");
        std::fs::write(dir.join("session.json"), serde_json::to_vec(&legacy).unwrap()).unwrap();
        std::fs::write(dir.join("sessions.json"), b"not json").unwrap();
        let store = ProfileSessionStore::new(&dir);
        assert!(store.active().is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn failed_target_persistence_keeps_active_profile_unchanged() {
        let dir = temp_dir();
        let store = ProfileSessionStore::new(&dir);
        let active = session("https://example.test", "u1", "active");
        let target = session("https://example.test", "u2", "target");
        store.save_active(&active).unwrap();
        std::fs::create_dir(dir.join("sessions.json.tmp")).unwrap();
        assert!(store.activate(&target).is_err());
        assert_eq!(store.active().unwrap(), Some(active));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn refresh_update_does_not_reinsert_a_signed_out_profile() {
        let dir = temp_dir();
        let store = ProfileSessionStore::new(&dir);
        let signed_out = session("https://example.test", "u1", "old");
        let refreshed = session("https://example.test", "u1", "new");
        assert!(!store.update_existing(&refreshed).unwrap());
        assert!(store.active().unwrap().is_none());
        store.save_active(&signed_out).unwrap();
        store.remove_active().unwrap();
        assert!(!store.update_existing(&refreshed).unwrap());
        assert!(store.active().unwrap().is_none());
        std::fs::remove_dir_all(dir).unwrap();
    }
}
