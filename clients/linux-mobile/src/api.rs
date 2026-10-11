//! Blocking Playarr Server client. Call it from worker threads only (see `ui::bg`).
use crate::model::*;
use crate::store::{self, Session};
use serde::de::DeserializeOwned;
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// Wire name sent to the server as `X-Playarr-Client-Platform`.
pub const SERVER_PLATFORM: &str = "linux-phone";
/// Identity the hosted link broker accepts for this app.
pub const BROKER_PLATFORM: &str = "linux-phone";

#[derive(Debug, Clone)]
pub enum ApiError {
    Http(u16),
    /// A rejection that carries the server's own message (for example the 422 colour-format refusal).
    Message(String),
    Transport(String),
    Decode(String),
}

impl std::fmt::Display for ApiError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ApiError::Http(401) => write!(f, "Signed out. Link this device again."),
            ApiError::Http(c) => write!(f, "The server answered HTTP {c}."),
            ApiError::Message(m) => write!(f, "{m}"),
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

/// Library browse filters, mapped onto `GET /api/v1/catalog`.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct CatalogQuery {
    pub kind: String,
    /// `title` or `date_added`.
    pub sort: String,
    pub genre: Option<String>,
    pub available_only: bool,
    pub descending: bool,
}

impl CatalogQuery {
    pub fn query_string(&self) -> String {
        // The web always sends the order explicitly (title, ascending by default).
        let mut q = format!(
            "kind={}&sort={}&order={}",
            self.kind,
            if self.sort.is_empty() { "title" } else { &self.sort },
            if self.descending { "desc" } else { "asc" }
        );
        if let Some(g) = &self.genre {
            q.push_str(&format!("&genre={}", urlenc(g)));
        }
        if self.available_only {
            q.push_str("&available_only=true");
        }
        q
    }
}

#[derive(Clone)]
pub struct Client {
    agent: ureq::Agent,
    /// For file downloads: no limit on the whole transfer, only on waiting for the server.
    stream_agent: ureq::Agent,
    session: Arc<Mutex<Session>>,
    /// Only one refresh runs at a time; the others wait and reuse its result.
    refresh_lock: Arc<Mutex<()>>,
}

impl Client {
    pub fn new(session: Session) -> Self {
        Client {
            agent: agent(),
            stream_agent: ureq::Agent::config_builder()
                .http_status_as_error(false)
                .timeout_global(None)
                .timeout_recv_response(Some(Duration::from_secs(60)))
                .timeout_recv_body(Some(Duration::from_secs(60)))
                .user_agent(concat!("playarr-linux-mobile/", env!("CARGO_PKG_VERSION")))
                .build()
                .into(),
            session: Arc::new(Mutex::new(session)),
            refresh_lock: Arc::default(),
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
            let used = self.token();
            let auth = format!("Bearer {used}");
            let url = self.url(path);
            let resp = match (method, body) {
                ("GET", _) => {
                    let agent = if path.ends_with("/file") {
                        &self.stream_agent
                    } else {
                        &self.agent
                    };
                    let mut rb = agent
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
                if self.refresh(&used).is_ok() {
                    continue;
                }
            }
            if code == 422 {
                // The playback negotiation refuses a colour format this device cannot be given; show the server's words.
                let mut resp = resp;
                let msg = resp
                    .body_mut()
                    .read_json::<serde_json::Value>()
                    .ok()
                    .and_then(|v| v.get("message")?.as_str().map(str::to_string));
                return Err(msg.map(ApiError::Message).unwrap_or(ApiError::Http(422)));
            }
            if !(200..300).contains(&code) {
                return Err(ApiError::Http(code));
            }
            return Ok(resp);
        }
    }

    /// Swaps the refresh token for a new pair. `used` is the access token that was refused: if another thread already
    /// replaced it, there is nothing to do. The new pair is on disk before anyone uses it.
    fn refresh(&self, used: &str) -> Result<()> {
        let _one = self.refresh_lock.lock().unwrap();
        if self.token() != used {
            return Ok(());
        }
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
        let q = CatalogQuery {
            kind: kind.into(),
            sort: sort.into(),
            available_only: true,
            ..Default::default()
        };
        self.catalog_filtered(&q, offset, limit)
    }
    pub fn catalog_filtered(&self, q: &CatalogQuery, offset: usize, limit: usize) -> Result<CatalogPage> {
        self.get(&format!(
            "/api/v1/catalog?{}&limit={limit}&offset={offset}",
            q.query_string()
        ))
    }
    pub fn calendar(&self, start: &str, end: &str) -> Result<Vec<CalendarEntry>> {
        Ok(self
            .get::<CalendarResponse>(&format!("/api/v1/calendar?start={start}&end={end}"))?
            .entries)
    }
    pub fn add_to_watchlist(&self, w: &Work) -> Result<()> {
        let body = serde_json::json!({ "kind": w.kind, "title": w.title, "work_id": w.id, "year": w.year().and_then(|y| y.parse::<i32>().ok()) });
        self.send("POST", "/api/v1/watchlist", Some(&body), None)?;
        Ok(())
    }
    pub fn set_avatar_preset(&self, id: &str) -> Result<()> {
        let body = serde_json::json!({ "preference": { "kind": "preset", "value": id } });
        self.send("PUT", "/api/v1/users/me/profile-avatar", Some(&body), None)?;
        Ok(())
    }
    /// A JSON GET for modules outside the UI.
    pub fn get_json<T: DeserializeOwned>(&self, path: &str) -> Result<T> {
        self.get(path)
    }
    /// Quality options for downloading a media file.
    pub fn download_options(&self, media_file_id: &str) -> Result<serde_json::Value> {
        self.get(&format!("/api/v1/media/{media_file_id}/download-options"))
    }
    /// Cuts a download ticket; returns its id.
    pub fn create_download_ticket(&self, media_file_id: &str, quality_id: &str) -> Result<String> {
        let body = serde_json::json!({ "media_file_id": media_file_id, "quality_id": quality_id });
        let v: serde_json::Value = self
            .send("POST", "/api/v1/downloads", Some(&body), None)?
            .body_mut()
            .read_json()
            .map_err(|e| ApiError::Decode(e.to_string()))?;
        v.get("id")
            .and_then(|i| i.as_str())
            .map(str::to_string)
            .ok_or_else(|| ApiError::Decode("no ticket id".into()))
    }
    /// Tells the server the file is stored on the device so it can drop its staged copy (best effort).
    pub fn complete_download_ticket(&self, ticket: &str) -> Result<()> {
        self.send(
            "POST",
            &format!("/api/v1/downloads/{ticket}/complete"),
            Some(&serde_json::json!({})),
            None,
        )?;
        Ok(())
    }
    /// Deletes a ticket server-side (best effort when canceling or deleting).
    pub fn delete_download_ticket(&self, ticket: &str) -> Result<()> {
        self.send("DELETE", &format!("/api/v1/downloads/{ticket}"), None, None)?;
        Ok(())
    }
    pub fn playlists(&self) -> Result<Vec<Playlist>> {
        self.get("/api/v1/playlists")
    }
    pub fn add_to_playlist(&self, playlist_id: &str, work_id: &str) -> Result<()> {
        let body = serde_json::json!({ "work_id": work_id });
        self.send(
            "POST",
            &format!("/api/v1/playlists/{playlist_id}/items"),
            Some(&body),
            None,
        )?;
        Ok(())
    }
    pub fn search(&self, q: &str) -> Result<Vec<Work>> {
        Ok(self
            .get::<SearchResults>(&format!(
                "/api/v1/catalog/search?q={}&limit=60&available_only=true",
                urlenc(q)
            ))?
            .items)
    }
    pub fn work(&self, id: &str) -> Result<WorkDetail> {
        self.get(&format!("/api/v1/catalog/{id}"))
    }
    pub fn resume_plans(&self) -> Result<Vec<ResumePlan>> {
        self.get("/api/v1/playback/resume-plans")
    }
    pub fn resume_plan(&self, series_id: &str) -> Option<ResumePlan> {
        self.get(&format!("/api/v1/catalog/{series_id}/resume-plan")).ok()
    }
    pub fn progress(&self, media_file_id: &str) -> Option<WatchProgress> {
        self.get(&format!("/api/v1/playback/{media_file_id}/progress")).ok()
    }
    pub fn all_progress(&self) -> Result<Vec<WatchProgress>> {
        self.get("/api/v1/playback/progress")
    }
    pub fn playback(&self, media_file_id: &str, start_ms: i64) -> Result<PlaybackInfo> {
        let settings = store::load_settings();
        let caps = crate::caps::Caps::detect().query(settings.force_direct_video, settings.force_direct_audio);
        let path = format!("/api/v1/playback/{media_file_id}?{caps}&start_position_ms={start_ms}");
        // The server answers 503 while every transcode slot is busy; wait and retry a few times. A 422
        // (colour format cannot be converted) is final: no retry.
        let mut tries = 0;
        loop {
            match self.get(&path) {
                Err(ApiError::Http(503)) if tries < 6 => {
                    tries += 1;
                    std::thread::sleep(Duration::from_secs(3));
                }
                other => return other,
            }
        }
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
    fn colour_format_422_shows_the_server_message_and_is_not_retried() {
        use std::io::{Read, Write};
        use std::sync::atomic::{AtomicUsize, Ordering};
        let hits = std::sync::Arc::new(AtomicUsize::new(0));
        let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = l.local_addr().unwrap();
        let h2 = hits.clone();
        std::thread::spawn(move || {
            for conn in l.incoming().flatten() {
                let mut conn = conn;
                let mut buf = [0u8; 4096];
                let _ = conn.read(&mut buf);
                h2.fetch_add(1, Ordering::SeqCst);
                let body = r#"{"error":"unsupported_colour_format","message":"This title's colour format can't be converted for this device."}"#;
                let _ = conn.write_all(format!("HTTP/1.1 422 Unprocessable Entity\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).as_bytes());
            }
        });
        let c = Client::new(Session {
            server_url: format!("http://{addr}"),
            access_token: "t".into(),
            refresh_token: "r".into(),
            device_id: "d".into(),
        });
        let err = c.playback("f", 0).unwrap_err();
        assert_eq!(
            err.to_string(),
            "This title's colour format can't be converted for this device."
        );
        assert_eq!(hits.load(Ordering::SeqCst), 1, "no retry");
    }

    #[test]
    fn catalog_query_string() {
        let q = CatalogQuery {
            kind: "movie".into(),
            sort: "date_added".into(),
            genre: Some("Sci Fi".into()),
            available_only: true,
            descending: false,
        };
        assert_eq!(
            q.query_string(),
            "kind=movie&sort=date_added&order=asc&genre=Sci%20Fi&available_only=true"
        );
        assert_eq!(
            CatalogQuery {
                kind: "series".into(),
                ..Default::default()
            }
            .query_string(),
            "kind=series&sort=title&order=asc"
        );
    }

    #[test]
    fn artwork_path_shape() {
        assert_eq!(
            Client::artwork_path("w1", "poster", 360),
            "/api/v1/artwork/work/w1/poster?w=360"
        );
    }
}
