//! Blocking Playarr Server client. Call it from worker threads only (see `ui::bg`).
use crate::model::*;
use crate::store::{self, ProfileSessionStore, Session};
use serde::de::DeserializeOwned;
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// Wire name sent to the server as `X-Playarr-Client-Platform`.
pub const SERVER_PLATFORM: &str = "linux-phone";
/// Identity the hosted link broker accepts for this app.
pub const BROKER_PLATFORM: &str = "linux-phone";

static SESSION_ROTATION_LOCK: Mutex<()> = Mutex::new(());

/// Serializes refresh/unlock rotations across clients that may share one saved profile session.
pub fn with_session_rotation<T>(operation: impl FnOnce() -> T) -> T {
    let _guard = SESSION_ROTATION_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    operation()
}

#[derive(Debug, Clone)]
pub enum ApiError {
    Http(u16),
    PinRequired,
    InvalidPin,
    /// A rejection that carries the server's own message (for example the 422 colour-format refusal).
    Message(String),
    Transport(String),
    Decode(String),
}

impl std::fmt::Display for ApiError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ApiError::Http(401) => write!(f, "Signed out. Link this device again."),
            ApiError::PinRequired => write!(f, "This profile needs its PIN to switch."),
            ApiError::InvalidPin => write!(f, "The PIN was not accepted."),
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
    /// ISO 639 codes from the language facets.
    pub audio_lang: Option<String>,
    pub subtitle_lang: Option<String>,
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
        if let Some(l) = &self.audio_lang {
            q.push_str(&format!("&audio_lang={}", urlenc(l)));
        }
        if let Some(l) = &self.subtitle_lang {
            q.push_str(&format!("&subtitle_lang={}", urlenc(l)));
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

    pub fn session(&self) -> Session {
        self.session.lock().unwrap().clone()
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
        refresh_and_update(
            &self.session,
            used,
            &ProfileSessionStore::new(store::data_dir()),
            refresh_target_session,
        )
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
    /// Audio and subtitle languages the catalogue has for `kind`, as (code, name) lists.
    pub fn catalog_languages(&self, kind: &str) -> Vec<Vec<(String, String)>> {
        let v: serde_json::Value = self
            .get(&format!("/api/v1/catalog/languages?kind={kind}&available_only=true"))
            .unwrap_or_default();
        ["audio", "subtitle"]
            .iter()
            .map(|k| {
                v.get(k)
                    .and_then(|a| a.as_array())
                    .map(|a| {
                        a.iter()
                            .filter_map(|l| {
                                Some((
                                    l.get("code")?.as_str()?.to_string(),
                                    l.get("name")?.as_str()?.to_string(),
                                ))
                            })
                            .collect()
                    })
                    .unwrap_or_default()
            })
            .collect()
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

fn refresh_and_update(
    client_session: &Mutex<Session>,
    rejected_token: &str,
    sessions: &ProfileSessionStore,
    refresh: impl FnOnce(&Session, &str) -> Result<Session>,
) -> Result<()> {
    with_session_rotation(|| {
        let current = client_session.lock().unwrap().clone();
        if current.access_token != rejected_token {
            return Ok(());
        }
        let user_id = store::jwt_claim(&current.access_token, "sub")
            .ok_or_else(|| ApiError::Decode("active token has no profile subject".into()))?;
        let Some(stored) = sessions
            .for_session(&current)
            .map_err(|error| ApiError::Message(error.to_string()))?
        else {
            return Ok(());
        };
        if stored.access_token != current.access_token || stored.refresh_token != current.refresh_token {
            *client_session.lock().unwrap() = stored;
            return Ok(());
        }
        let updated = refresh(&current, &user_id)?;
        if !sessions
            .update_existing(&updated)
            .map_err(|error| ApiError::Message(error.to_string()))?
        {
            return Ok(());
        }
        *client_session.lock().unwrap() = updated;
        Ok(())
    })
}

#[derive(serde::Deserialize)]
struct AuthTokenPair {
    access_token: String,
    refresh_token: String,
    user_id: String,
}

fn target_auth_request(session: &Session, route: &str, body: &serde_json::Value, user_id: &str) -> Result<Session> {
    if store::jwt_claim(&session.access_token, "sub").as_deref() != Some(user_id) {
        return Err(ApiError::Decode(
            "saved session does not match the requested profile".into(),
        ));
    }
    let base = session.server_url.trim_end_matches('/');
    let url = format!("{base}/api/v1/auth/{route}");
    let mut response = agent()
        .post(&url)
        .header("X-Playarr-Client-Platform", SERVER_PLATFORM)
        .send_json(body)?;
    let status = response.status().as_u16();
    if !(200..300).contains(&status) {
        let error = response
            .body_mut()
            .read_json::<serde_json::Value>()
            .ok()
            .and_then(|value| value.get("error")?.as_str().map(str::to_owned));
        if status == 403 && error.as_deref() == Some("pin_required") {
            return Err(ApiError::PinRequired);
        }
        if status == 401 && error.as_deref() == Some("invalid_pin") {
            return Err(ApiError::InvalidPin);
        }
        return Err(ApiError::Http(status));
    }
    let tokens: AuthTokenPair = response
        .body_mut()
        .read_json()
        .map_err(|error| ApiError::Decode(error.to_string()))?;
    if tokens.user_id != user_id || store::jwt_claim(&tokens.access_token, "sub").as_deref() != Some(user_id) {
        return Err(ApiError::Decode(
            "server returned credentials for a different profile".into(),
        ));
    }
    Ok(Session {
        server_url: session.server_url.clone(),
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        device_id: session.device_id.clone(),
    })
}

/// Refreshes a saved target session without mutating a `Client` or persisting it as active.
pub fn refresh_target_session(session: &Session, user_id: &str) -> Result<Session> {
    let body = serde_json::json!({
        "refresh_token": session.refresh_token,
        "device_id": session.device_id,
    });
    target_auth_request(session, "refresh", &body, user_id)
}

/// Unlocks a saved target session after its refresh endpoint requested a profile PIN.
pub fn unlock_target_session(session: &Session, user_id: &str, pin: &str) -> Result<Session> {
    let body = serde_json::json!({
        "refresh_token": session.refresh_token,
        "device_id": session.device_id,
        "pin": pin,
    });
    target_auth_request(session, "unlock", &body, user_id)
}

/// Clears an outgoing profile's device-bound PIN lease. Switching already succeeded, so callers ignore failures.
pub fn lock_session(session: &Session) -> Result<()> {
    let base = session.server_url.trim_end_matches('/');
    let response = agent()
        .post(format!("{base}/api/v1/auth/lock"))
        .header("Authorization", &format!("Bearer {}", session.access_token))
        .header("X-Playarr-Client-Platform", SERVER_PLATFORM)
        .send_json(serde_json::json!({}))?;
    if !(200..300).contains(&response.status().as_u16()) {
        return Err(ApiError::Http(response.status().as_u16()));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mock_auth_reply(
        status: u16,
        body: impl Into<String> + Send + 'static,
    ) -> (String, std::thread::JoinHandle<String>) {
        use std::io::{Read, Write};
        let body = body.into();
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let thread = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = Vec::new();
            let mut buffer = [0u8; 2048];
            let header_end;
            loop {
                let count = stream.read(&mut buffer).unwrap();
                assert!(count > 0);
                request.extend_from_slice(&buffer[..count]);
                if let Some(index) = request.windows(4).position(|bytes| bytes == b"\r\n\r\n") {
                    header_end = index + 4;
                    break;
                }
            }
            let headers = String::from_utf8_lossy(&request[..header_end]);
            let content_length = headers
                .lines()
                .find_map(|line| {
                    line.to_ascii_lowercase()
                        .strip_prefix("content-length: ")
                        .map(str::to_owned)
                })
                .and_then(|length| length.trim().parse::<usize>().ok());
            let chunked = headers.lines().any(|line| {
                line.to_ascii_lowercase()
                    .strip_prefix("transfer-encoding: ")
                    .is_some_and(|value| value.trim().eq_ignore_ascii_case("chunked"))
            });
            let body_start = header_end;
            if let Some(content_length) = content_length {
                while request.len() < body_start + content_length {
                    let count = stream.read(&mut buffer).unwrap();
                    assert!(count > 0);
                    request.extend_from_slice(&buffer[..count]);
                }
            } else if chunked {
                while !request[body_start..].windows(5).any(|bytes| bytes == b"0\r\n\r\n") {
                    let count = stream.read(&mut buffer).unwrap();
                    assert!(count > 0);
                    request.extend_from_slice(&buffer[..count]);
                }
            }
            let decoded_body = if chunked {
                let encoded = &request[body_start..];
                let mut decoded = Vec::new();
                let mut cursor = 0;
                loop {
                    let line_end = encoded[cursor..]
                        .windows(2)
                        .position(|bytes| bytes == b"\r\n")
                        .map(|offset| cursor + offset)
                        .expect("chunk size line terminator");
                    let size_line = std::str::from_utf8(&encoded[cursor..line_end]).unwrap();
                    let size = usize::from_str_radix(size_line.split(';').next().unwrap().trim(), 16).unwrap();
                    cursor = line_end + 2;
                    if size == 0 {
                        break;
                    }
                    assert!(encoded.len() >= cursor + size + 2, "complete chunk payload");
                    decoded.extend_from_slice(&encoded[cursor..cursor + size]);
                    cursor += size;
                    assert_eq!(&encoded[cursor..cursor + 2], b"\r\n");
                    cursor += 2;
                }
                decoded
            } else {
                let end = body_start + content_length.unwrap_or(0);
                request[body_start..end].to_vec()
            };
            let captured = format!(
                "{}{}",
                String::from_utf8_lossy(&request[..header_end]),
                String::from_utf8_lossy(&decoded_body)
            );
            let reason = if (200..300).contains(&status) {
                "OK"
            } else {
                "Forbidden"
            };
            write!(
                stream,
                "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            )
            .unwrap();
            captured
        });
        (format!("http://{addr}/proxy/prefix"), thread)
    }

    fn target_session(base: String) -> Session {
        Session {
            server_url: base,
            access_token: test_access_token("u2", "old"),
            refresh_token: "old-refresh".into(),
            device_id: "target-device".into(),
        }
    }

    fn test_access_token(user_id: &str, suffix: &str) -> String {
        const URL_SAFE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
        let claims = serde_json::json!({"sub": user_id}).to_string();
        let mut encoded = String::new();
        for bytes in claims.as_bytes().chunks(3) {
            let first = bytes[0] as usize;
            let second = bytes.get(1).copied().unwrap_or_default() as usize;
            let third = bytes.get(2).copied().unwrap_or_default() as usize;
            encoded.push(URL_SAFE[first >> 2] as char);
            encoded.push(URL_SAFE[((first & 0b11) << 4) | (second >> 4)] as char);
            if bytes.len() > 1 {
                encoded.push(URL_SAFE[((second & 0b1111) << 2) | (third >> 6)] as char);
            }
            if bytes.len() > 2 {
                encoded.push(URL_SAFE[third & 0b11_1111] as char);
            }
        }
        format!("test.{encoded}.{suffix}")
    }

    fn saved_session(user_id: &str, suffix: &str) -> Session {
        Session {
            server_url: "https://session.test/base".into(),
            access_token: test_access_token(user_id, suffix),
            refresh_token: format!("refresh-{user_id}-{suffix}"),
            device_id: format!("device-{user_id}"),
        }
    }

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
            audio_lang: Some("it".into()),
            subtitle_lang: None,
        };
        assert_eq!(
            q.query_string(),
            "kind=movie&sort=date_added&order=asc&genre=Sci%20Fi&audio_lang=it&available_only=true"
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

    #[test]
    fn standalone_refresh_rotates_target_pair_and_preserves_server_path_prefix() {
        let (base, server) = mock_auth_reply(
            200,
            serde_json::json!({
                "access_token": test_access_token("u2", "new"),
                "refresh_token": "rotated",
                "user_id": "u2"
            })
            .to_string(),
        );
        let updated = refresh_target_session(&target_session(base), "u2").unwrap();
        let request = server.join().unwrap();
        assert!(request.starts_with("POST /proxy/prefix/api/v1/auth/refresh HTTP/1.1"));
        assert!(request.contains("old-refresh"));
        assert!(request.contains("target-device"));
        assert_eq!(updated.refresh_token, "rotated");
        assert_eq!(store::jwt_claim(&updated.access_token, "sub").as_deref(), Some("u2"));
    }

    #[test]
    fn pin_required_is_distinguished_without_changing_target_session() {
        let (base, server) = mock_auth_reply(403, r#"{"error":"pin_required"}"#);
        let original = target_session(base);
        assert!(matches!(
            refresh_target_session(&original, "u2"),
            Err(ApiError::PinRequired)
        ));
        server.join().unwrap();
        assert_eq!(original.refresh_token, "old-refresh");
    }

    #[test]
    fn invalid_pin_is_classified_without_mutating_target_session() {
        let (base, server) = mock_auth_reply(401, r#"{"error":"invalid_pin"}"#);
        let original = target_session(base);
        assert!(matches!(
            unlock_target_session(&original, "u2", "incorrect"),
            Err(ApiError::InvalidPin)
        ));
        let request = server.join().unwrap();
        assert!(request.to_ascii_lowercase().contains("content-type: application/json"));
        let request_body = request.split_once("\r\n\r\n").unwrap().1;
        let json: serde_json::Value = serde_json::from_str(request_body).unwrap();
        assert_eq!(json["pin"], "incorrect");
        assert_eq!(original.refresh_token, "old-refresh");
    }

    #[test]
    fn unlock_rotates_target_pair_and_sends_pin_only_in_request_body() {
        let (base, server) = mock_auth_reply(
            200,
            serde_json::json!({
                "access_token": test_access_token("u2", "unlocked"),
                "refresh_token": "unlock-rotated",
                "user_id": "u2"
            })
            .to_string(),
        );
        let updated = unlock_target_session(&target_session(base), "u2", "4826").unwrap();
        let request = server.join().unwrap();
        assert!(request.starts_with("POST /proxy/prefix/api/v1/auth/unlock HTTP/1.1"));
        assert!(request.to_ascii_lowercase().contains("content-type: application/json"));
        let request_body = request.split_once("\r\n\r\n").unwrap().1;
        let json: serde_json::Value = serde_json::from_str(request_body).unwrap();
        assert_eq!(json["pin"], "4826");
        assert_eq!(updated.refresh_token, "unlock-rotated");
    }

    #[test]
    fn refresh_rejects_response_for_another_profile() {
        let (base, server) = mock_auth_reply(
            200,
            serde_json::json!({
                "access_token": test_access_token("u1", "wrong"),
                "refresh_token": "wrong",
                "user_id": "u1"
            })
            .to_string(),
        );
        assert!(matches!(
            refresh_target_session(&target_session(base), "u2"),
            Err(ApiError::Decode(_))
        ));
        server.join().unwrap();
    }

    #[test]
    fn client_refresh_updates_existing_inactive_session_without_activating_it() {
        use std::sync::atomic::{AtomicU64, Ordering};
        static NEXT_DIR: AtomicU64 = AtomicU64::new(0);
        let dir = std::env::temp_dir().join(format!(
            "playarr-api-refresh-{}-{}",
            std::process::id(),
            NEXT_DIR.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let sessions = ProfileSessionStore::new(&dir);
        let active = saved_session("u1", "active");
        let inactive = saved_session("u2", "old");
        sessions.save_active(&active).unwrap();
        sessions.save_inactive(&inactive).unwrap();
        let client_session = Mutex::new(inactive.clone());
        let updated = saved_session("u2", "rotated");
        refresh_and_update(&client_session, &inactive.access_token, &sessions, |_, _| {
            Ok(updated.clone())
        })
        .unwrap();
        assert_eq!(*client_session.lock().unwrap(), updated);
        assert_eq!(sessions.active().unwrap(), Some(active));
        assert_eq!(sessions.get("https://session.test/base", "u2").unwrap(), Some(updated));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn refresh_after_signout_does_not_call_server_or_reinsert_profile() {
        use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
        static NEXT_DIR: AtomicU64 = AtomicU64::new(1000);
        let dir = std::env::temp_dir().join(format!(
            "playarr-api-refresh-{}-{}",
            std::process::id(),
            NEXT_DIR.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let sessions = ProfileSessionStore::new(&dir);
        let old = saved_session("u1", "old");
        sessions.save_active(&old).unwrap();
        sessions.remove_active().unwrap();
        let client_session = Mutex::new(old.clone());
        let called = AtomicBool::new(false);
        refresh_and_update(&client_session, &old.access_token, &sessions, |_, _| {
            called.store(true, Ordering::SeqCst);
            Ok(saved_session("u1", "rotated"))
        })
        .unwrap();
        assert!(!called.load(Ordering::SeqCst));
        assert_eq!(*client_session.lock().unwrap(), old);
        assert!(sessions.active().unwrap().is_none());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn stale_client_reuses_newer_saved_pair_without_redeeming_old_refresh_token() {
        use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
        static NEXT_DIR: AtomicU64 = AtomicU64::new(2000);
        let dir = std::env::temp_dir().join(format!(
            "playarr-api-refresh-{}-{}",
            std::process::id(),
            NEXT_DIR.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let sessions = ProfileSessionStore::new(&dir);
        let active = saved_session("u1", "active");
        let stale = saved_session("u2", "stale");
        let latest = saved_session("u2", "latest");
        sessions.save_active(&active).unwrap();
        sessions.save_inactive(&latest).unwrap();
        let client_session = Mutex::new(stale.clone());
        let called = AtomicBool::new(false);
        refresh_and_update(&client_session, &stale.access_token, &sessions, |_, _| {
            called.store(true, Ordering::SeqCst);
            Ok(saved_session("u2", "unexpected"))
        })
        .unwrap();
        assert!(!called.load(Ordering::SeqCst));
        assert_eq!(*client_session.lock().unwrap(), latest);
        assert_eq!(sessions.active().unwrap(), Some(active));
        std::fs::remove_dir_all(dir).unwrap();
    }
}
