//! Blocking Playarr Server client. Call it from worker threads only (see `ui::bg`).
use crate::model::*;
use crate::store::{self, Session};
use serde::de::DeserializeOwned;
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// Wire name sent to the server as `X-Playarr-Client-Platform`. The server's closed enum has no
/// "linux-phone" yet, so this stays "web" until it does; flip this one constant then.
pub const SERVER_PLATFORM: &str = "web";
/// Identity the hosted link broker accepts for this app.
pub const BROKER_PLATFORM: &str = "linux-phone";

#[derive(Debug, Clone)]
pub enum ApiError {
    Http(u16),
    Transport(String),
    Decode(String),
}

impl std::fmt::Display for ApiError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ApiError::Http(401) => write!(f, "Signed out. Link this device again."),
            ApiError::Http(c) => write!(f, "The server answered HTTP {c}."),
            ApiError::Transport(m) => write!(f, "Could not reach the server ({m})."),
            ApiError::Decode(m) => write!(f, "Unexpected server reply ({m})."),
        }
    }
}

pub type Result<T> = std::result::Result<T, ApiError>;

impl From<ureq::Error> for ApiError {
    fn from(e: ureq::Error) -> Self {
        ApiError::Transport(e.to_string())
    }
}

pub fn agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .http_status_as_error(false)
        .timeout_global(Some(Duration::from_secs(30)))
        .user_agent(concat!("playarr-linux-mobile/", env!("CARGO_PKG_VERSION")))
        .build()
        .into()
}

/// Percent-encodes a query value.
pub fn urlenc(s: &str) -> String {
    let mut o = String::new();
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => o.push(b as char),
            _ => o.push_str(&format!("%{b:02X}")),
        }
    }
    o
}

#[derive(Clone)]
pub struct Client {
    agent: ureq::Agent,
    session: Arc<Mutex<Session>>,
}

impl Client {
    pub fn new(session: Session) -> Self {
        Client {
            agent: agent(),
            session: Arc::new(Mutex::new(session)),
        }
    }

    pub fn base(&self) -> String {
        self.session
            .lock()
            .unwrap()
            .server_url
            .trim_end_matches('/')
            .to_string()
    }

    pub fn token(&self) -> String {
        self.session.lock().unwrap().access_token.clone()
    }

    fn url(&self, path: &str) -> String {
        format!("{}{}", self.base(), path)
    }

    fn send(
        &self,
        method: &str,
        path: &str,
        body: Option<&serde_json::Value>,
        range: Option<&str>,
    ) -> Result<ureq::http::Response<ureq::Body>> {
        let mut refreshed = false;
        loop {
            let auth = format!("Bearer {}", self.token());
            let url = self.url(path);
            let resp = match (method, body) {
                ("GET", _) => {
                    let mut rb = self
                        .agent
                        .get(&url)
                        .header("Authorization", &auth)
                        .header("X-Playarr-Client-Platform", SERVER_PLATFORM);
                    if let Some(r) = range {
                        rb = rb.header("Range", r);
                    }
                    rb.call()?
                }
                ("PUT", Some(b)) => self
                    .agent
                    .put(&url)
                    .header("Authorization", &auth)
                    .header("X-Playarr-Client-Platform", SERVER_PLATFORM)
                    .send_json(b)?,
                (_, Some(b)) => self
                    .agent
                    .post(&url)
                    .header("Authorization", &auth)
                    .header("X-Playarr-Client-Platform", SERVER_PLATFORM)
                    .send_json(b)?,
                _ => return Err(ApiError::Decode("bad request".into())),
            };
            let code = resp.status().as_u16();
            if code == 401 && !refreshed {
                refreshed = true;
                if self.refresh().is_ok() {
                    continue;
                }
            }
            if !(200..300).contains(&code) {
                return Err(ApiError::Http(code));
            }
            return Ok(resp);
        }
    }

    fn refresh(&self) -> Result<()> {
        let (refresh_token, device_id) = {
            let s = self.session.lock().unwrap();
            (s.refresh_token.clone(), s.device_id.clone())
        };
        let body = serde_json::json!({"refresh_token": refresh_token, "device_id": device_id});
        let mut resp = self.agent.post(&self.url("/api/v1/auth/refresh")).send_json(&body)?;
        if resp.status().as_u16() != 200 {
            return Err(ApiError::Http(resp.status().as_u16()));
        }
        let t: Tokens = resp
            .body_mut()
            .read_json()
            .map_err(|e| ApiError::Decode(e.to_string()))?;
        let mut s = self.session.lock().unwrap();
        s.access_token = t.access_token;
        s.refresh_token = t.refresh_token;
        store::save_session(&s);
        Ok(())
    }

    fn get<T: DeserializeOwned>(&self, path: &str) -> Result<T> {
        self.send("GET", path, None, None)?
            .body_mut()
            .read_json()
            .map_err(|e| ApiError::Decode(e.to_string()))
    }

    /// Opens an authenticated GET for the local playback proxy (optionally a byte range).
    pub fn stream(&self, path: &str, range: Option<&str>) -> Result<ureq::http::Response<ureq::Body>> {
        self.send("GET", path, None, range)
    }

    pub fn bytes(&self, path: &str) -> Result<Vec<u8>> {
        self.send("GET", path, None, None)?
            .body_mut()
            .read_to_vec()
            .map_err(|e| ApiError::Decode(e.to_string()))
    }

    pub fn profiles(&self) -> Result<Vec<Profile>> {
        self.get("/api/v1/users/profiles")
    }
    /// The signed-in profile's avatar preset id, when it chose one.
    pub fn avatar_preset(&self) -> Option<String> {
        let v: serde_json::Value = self.get("/api/v1/users/me/profile-avatar").ok()?;
        let p = v.get("preference")?;
        (p.get("kind")?.as_str()? == "preset").then(|| p.get("value")?.as_str().map(str::to_string))?
    }
    pub fn home_rails(&self) -> Result<Vec<Rail>> {
        Ok(self.get::<HomeRails>("/api/v1/home/rails")?.rails)
    }
    pub fn catalog(&self, kind: &str, offset: usize, limit: usize, sort: &str) -> Result<CatalogPage> {
        self.get(&format!(
            "/api/v1/catalog?kind={kind}&limit={limit}&offset={offset}&sort={sort}"
        ))
    }
    pub fn search(&self, q: &str) -> Result<Vec<Work>> {
        Ok(self
            .get::<SearchResults>(&format!("/api/v1/catalog/search?q={}&limit=40", urlenc(q)))?
            .items)
    }
    pub fn work(&self, id: &str) -> Result<WorkDetail> {
        self.get(&format!("/api/v1/catalog/{id}"))
    }
    pub fn resume_plans(&self) -> Result<Vec<ResumePlan>> {
        self.get("/api/v1/playback/resume-plans")
    }
    pub fn progress(&self, media_file_id: &str) -> Option<WatchProgress> {
        self.get(&format!("/api/v1/playback/{media_file_id}/progress")).ok()
    }
    pub fn playback(&self, media_file_id: &str, start_ms: i64) -> Result<PlaybackInfo> {
        // The GStreamer HLS/MP4 pipeline plays H.264/AAC in MP4 or TS; the server transcodes anything else.
        self.get(&format!(
            "/api/v1/playback/{media_file_id}?containers=mp4,mov&video_codecs=h264&audio_codecs=aac,mp3&start_position_ms={start_ms}"
        ))
    }
    pub fn report_progress(
        &self,
        media_file_id: &str,
        position_ms: i64,
        duration_ms: i64,
        completed: bool,
    ) -> Result<()> {
        let body = serde_json::to_value(ProgressUpdate {
            position_ms,
            duration_ms,
            completed,
        })
        .unwrap();
        self.send(
            "PUT",
            &format!("/api/v1/playback/{media_file_id}/progress"),
            Some(&body),
            None,
        )?;
        Ok(())
    }
    pub fn artwork_path(work_id: &str, kind: &str, width: u32) -> String {
        format!("/api/v1/artwork/work/{work_id}/{kind}?w={width}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn urlenc_escapes() {
        assert_eq!(urlenc("a b&c"), "a%20b%26c");
        assert_eq!(urlenc("Zoë"), "Zo%C3%AB");
    }

    #[test]
    fn artwork_path_shape() {
        assert_eq!(
            Client::artwork_path("w1", "poster", 360),
            "/api/v1/artwork/work/w1/poster?w=360"
        );
    }
}
