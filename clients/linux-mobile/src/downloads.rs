//! Offline downloads: the server cuts a ticket per media file and quality, this module fetches the ticket's file
//! with Range requests so a download can pause, resume and survive a restart, and keeps the list on disk.
use crate::api::{ApiError, Client};
use serde::{Deserialize, Serialize};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, AtomicU8, Ordering};
use std::time::Duration;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum State {
    Preparing,
    Downloading,
    Paused,
    Completed,
    Failed,
}

/// One download. Episodes carry the series, season and episode so the list can group them.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Item {
    pub id: String,
    pub media_file_id: String,
    pub work_id: String,
    pub title: String,
    #[serde(default)]
    pub series_title: Option<String>,
    #[serde(default)]
    pub season: Option<i32>,
    #[serde(default)]
    pub episode: Option<i32>,
    pub quality_id: String,
    pub quality_label: String,
    #[serde(default)]
    pub ticket_id: Option<String>,
    pub state: State,
    pub bytes_done: u64,
    pub bytes_total: u64,
    pub container: String,
    /// Unix seconds after which a finished download is removed; `None` keeps it until deleted.
    #[serde(default)]
    pub keep_until: Option<i64>,
    #[serde(default)]
    pub error: Option<String>,
}

pub fn dir() -> PathBuf {
    crate::store::data_dir().join("downloads")
}

impl Item {
    pub fn path(&self) -> PathBuf {
        dir().join(format!(
            "{}.{}",
            self.id,
            if self.container.is_empty() {
                "mp4"
            } else {
                &self.container
            }
        ))
    }

    pub fn percent(&self) -> u32 {
        if self.bytes_total == 0 {
            0
        } else {
            ((self.bytes_done as f64 / self.bytes_total as f64) * 100.0).min(100.0) as u32
        }
    }

    /// "42% · 1.2 GB" style status line.
    pub fn status_line(&self) -> String {
        match self.state {
            State::Preparing => "Preparing…".into(),
            State::Downloading => format!("{}% · {}", self.percent(), human_size(self.bytes_total)),
            State::Paused => format!("Paused at {}% · {}", self.percent(), human_size(self.bytes_total)),
            State::Completed => format!("Ready offline · {}", human_size(self.bytes_total)),
            State::Failed => format!(
                "Failed{}",
                self.error.as_deref().map(|e| format!(": {e}")).unwrap_or_default()
            ),
        }
    }

    pub fn expired(&self, now: i64) -> bool {
        self.state == State::Completed && self.keep_until.map(|t| t <= now).unwrap_or(false)
    }
}

pub fn human_size(bytes: u64) -> String {
    const UNITS: [&str; 4] = ["B", "KB", "MB", "GB"];
    let mut v = bytes as f64;
    let mut i = 0;
    while v >= 1000.0 && i < 3 {
        v /= 1000.0;
        i += 1;
    }
    if i == 0 {
        format!("{bytes} B")
    } else {
        format!("{v:.1} {}", UNITS[i])
    }
}

pub fn load() -> Vec<Item> {
    std::fs::read_to_string(dir().join("downloads.json"))
        .ok()
        .and_then(|t| serde_json::from_str::<Vec<Item>>(&t).ok())
        .unwrap_or_default()
        .into_iter()
        // A download that was running when the app closed resumes as paused.
        .map(|mut i| {
            if matches!(i.state, State::Downloading | State::Preparing) {
                i.state = State::Paused;
            }
            i
        })
        .collect()
}

pub fn save(items: &[Item]) {
    let _ = std::fs::create_dir_all(dir());
    if let Ok(t) = serde_json::to_string_pretty(items) {
        let _ = std::fs::write(dir().join("downloads.json"), t);
    }
}

/// Removes the file (and a partial one) of an item.
pub fn remove_files(item: &Item) {
    let _ = std::fs::remove_file(item.path());
    let _ = std::fs::remove_file(item.path().with_extension("part"));
}

/// What the worker should do next, set from the UI thread.
pub const RUN: u8 = 0;
pub const PAUSE: u8 = 1;
pub const CANCEL: u8 = 2;

/// Shared between the worker thread and the UI.
#[derive(Default)]
pub struct Control {
    pub want: AtomicU8,
    pub done: AtomicU64,
    pub total: AtomicU64,
}

pub enum Outcome {
    Completed { total: u64 },
    Paused,
    Canceled,
    Failed(String),
}

fn ticket_state(c: &Client, ticket: &str) -> Result<(String, Option<u64>, Option<String>), ApiError> {
    let v: serde_json::Value = c.get_json(&format!("/api/v1/downloads/{ticket}"))?;
    Ok((
        v.get("status").and_then(|s| s.as_str()).unwrap_or("").to_string(),
        v.get("size_bytes").and_then(|s| s.as_u64()),
        v.get("error_message").and_then(|s| s.as_str()).map(str::to_string),
    ))
}

/// Blocking download of one item: ticket, wait until ready, then the file from `bytes_done` on.
/// Updates `item` (ticket, sizes) as it learns them and `ctl` as bytes arrive.
pub fn run(c: &Client, item: &mut Item, ctl: &Control) -> Outcome {
    let stopped = |ctl: &Control| match ctl.want.load(Ordering::SeqCst) {
        CANCEL => Some(Outcome::Canceled),
        PAUSE => Some(Outcome::Paused),
        _ => None,
    };
    let ticket = match item.ticket_id.clone() {
        Some(t) => t,
        None => match c.create_download_ticket(&item.media_file_id, &item.quality_id) {
            Ok(t) => {
                item.ticket_id = Some(t.clone());
                t
            }
            Err(e) => return Outcome::Failed(e.to_string()),
        },
    };
    // The server prepares the file first (queued, processing, ready).
    for _ in 0..600 {
        if let Some(o) = stopped(ctl) {
            return o;
        }
        match ticket_state(c, &ticket) {
            Ok((s, size, err)) => match s.as_str() {
                "ready" => {
                    if let Some(n) = size {
                        item.bytes_total = n;
                        ctl.total.store(n, Ordering::SeqCst);
                    }
                    break;
                }
                "failed" | "expired" | "canceled" => return Outcome::Failed(err.unwrap_or(s)),
                _ => std::thread::sleep(Duration::from_secs(2)),
            },
            Err(e) => return Outcome::Failed(e.to_string()),
        }
    }
    let part = item.path().with_extension("part");
    let _ = std::fs::create_dir_all(dir());
    let have = std::fs::metadata(&part).map(|m| m.len()).unwrap_or(0);
    let range = if have > 0 { Some(format!("bytes={have}-")) } else { None };
    let mut resp = match c.stream(&format!("/api/v1/downloads/{ticket}/file"), range.as_deref()) {
        Ok(r) => r,
        Err(e) => return Outcome::Failed(e.to_string()),
    };
    // A server that ignores the range sends the whole file again.
    let resumed = resp.status().as_u16() == 206;
    let mut file = match std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(!resumed)
        .open(&part)
    {
        Ok(f) => f,
        Err(e) => return Outcome::Failed(e.to_string()),
    };
    let mut done = if resumed { have } else { 0 };
    let _ = file.seek(SeekFrom::Start(done));
    if item.bytes_total == 0 {
        item.bytes_total = resp
            .headers()
            .get("content-length")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse::<u64>().ok())
            .map(|n| n + done)
            .unwrap_or(0);
        ctl.total.store(item.bytes_total, Ordering::SeqCst);
    }
    ctl.done.store(done, Ordering::SeqCst);
    let mut reader = resp.body_mut().as_reader();
    let mut buf = vec![0u8; 64 * 1024];
    loop {
        if let Some(o) = stopped(ctl) {
            let _ = file.flush();
            return o;
        }
        match reader.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                if let Err(e) = file.write_all(&buf[..n]) {
                    return Outcome::Failed(e.to_string());
                }
                done += n as u64;
                ctl.done.store(done, Ordering::SeqCst);
            }
            Err(e) => return Outcome::Failed(e.to_string()),
        }
    }
    let _ = file.flush();
    drop(file);
    if item.bytes_total > 0 && done < item.bytes_total {
        return Outcome::Failed("The connection dropped before the file was complete.".into());
    }
    if std::fs::rename(&part, item.path()).is_err() {
        return Outcome::Failed("Could not save the file.".into());
    }
    Outcome::Completed { total: done }
}

/// One series (or the movies, as `None`) with its seasons.
pub type Group<'a> = (Option<String>, Vec<(Option<i32>, Vec<&'a Item>)>);

/// Series, then season, then episode, as the web groups TV downloads. Movies come first as single entries.
pub fn grouped(items: &[Item]) -> Vec<Group<'_>> {
    let mut out: Vec<Group<'_>> = Vec::new();
    let mut sorted: Vec<&Item> = items.iter().collect();
    sorted.sort_by(|a, b| {
        (a.series_title.is_some(), &a.series_title, a.season, a.episode, &a.title).cmp(&(
            b.series_title.is_some(),
            &b.series_title,
            b.season,
            b.episode,
            &b.title,
        ))
    });
    for it in sorted {
        let series = it.series_title.clone();
        if out.last().map(|(s, _)| s != &series).unwrap_or(true) || series.is_none() {
            out.push((series.clone(), Vec::new()));
        }
        let seasons = &mut out.last_mut().unwrap().1;
        if seasons.last().map(|(s, _)| *s != it.season).unwrap_or(true) {
            seasons.push((it.season, Vec::new()));
        }
        seasons.last_mut().unwrap().1.push(it);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::Session;
    use std::net::TcpListener;
    use std::sync::{Arc, Mutex};

    fn item(id: &str) -> Item {
        Item {
            id: id.into(),
            media_file_id: "mf".into(),
            work_id: "w".into(),
            title: "Test Movie A".into(),
            series_title: None,
            season: None,
            episode: None,
            quality_id: "orig".into(),
            quality_label: "Original".into(),
            ticket_id: None,
            state: State::Preparing,
            bytes_done: 0,
            bytes_total: 0,
            container: "mp4".into(),
            keep_until: None,
            error: None,
        }
    }

    /// Server that cuts a ticket, reports it ready and serves `body` with Range support; records Range headers.
    fn server(body: &'static [u8]) -> (String, Arc<Mutex<Vec<String>>>) {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = l.local_addr().unwrap();
        let ranges: Arc<Mutex<Vec<String>>> = Arc::default();
        let r2 = ranges.clone();
        std::thread::spawn(move || {
            for conn in l.incoming().flatten() {
                let mut conn = conn;
                let mut buf = [0u8; 8192];
                let n = std::io::Read::read(&mut conn, &mut buf).unwrap_or(0);
                let req = String::from_utf8_lossy(&buf[..n]).to_string();
                let line = req.lines().next().unwrap_or("").to_string();
                let json = |code: &str, b: String| {
                    format!("HTTP/1.1 {code}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{b}", b.len())
                };
                if line.starts_with("POST /api/v1/downloads ") {
                    let _ = conn.write_all(json("200 OK", r#"{"id":"tk1","status":"queued"}"#.into()).as_bytes());
                } else if line.starts_with("GET /api/v1/downloads/tk1/file") {
                    let range = req
                        .lines()
                        .find(|l| l.to_lowercase().starts_with("range:"))
                        .map(|l| l[6..].trim().to_string());
                    let (code, start) = match &range {
                        Some(r) => (
                            "206 Partial Content",
                            r.trim_start_matches("bytes=")
                                .trim_end_matches('-')
                                .parse::<usize>()
                                .unwrap_or(0),
                        ),
                        None => ("200 OK", 0),
                    };
                    r2.lock().unwrap().push(range.unwrap_or_default());
                    let part = &body[start..];
                    let _ = conn.write_all(
                        format!(
                            "HTTP/1.1 {code}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                            part.len()
                        )
                        .as_bytes(),
                    );
                    let _ = conn.write_all(part);
                } else if line.starts_with("GET /api/v1/downloads/tk1") {
                    let _ = conn.write_all(
                        json(
                            "200 OK",
                            format!(r#"{{"id":"tk1","status":"ready","size_bytes":{}}}"#, body.len()),
                        )
                        .as_bytes(),
                    );
                }
            }
        });
        (format!("http://{addr}"), ranges)
    }

    fn client(url: String) -> Client {
        Client::new(Session {
            server_url: url,
            access_token: "t".into(),
            refresh_token: "r".into(),
            device_id: "d".into(),
        })
    }

    #[test]
    fn downloads_a_file_then_resumes_after_pause() {
        let dirpath = std::env::temp_dir().join(format!("pa-dl-{}", std::process::id()));
        std::env::set_var("XDG_DATA_HOME", &dirpath);
        let (url, ranges) = server(b"0123456789abcdefghij");
        let c = client(url);
        let mut it = item("t1");
        // First run: the pause flag is set after the ticket is ready, so nothing is fetched.
        let ctl = Control::default();
        ctl.want.store(PAUSE, Ordering::SeqCst);
        assert!(matches!(run(&c, &mut it, &ctl), Outcome::Paused));
        // Pretend 10 bytes arrived earlier, then resume: the request carries the range.
        std::fs::create_dir_all(dir()).unwrap();
        std::fs::write(it.path().with_extension("part"), b"0123456789").unwrap();
        let ctl = Control::default();
        match run(&c, &mut it, &ctl) {
            Outcome::Completed { total } => assert_eq!(total, 20),
            _ => panic!("expected completion"),
        }
        assert_eq!(std::fs::read(it.path()).unwrap(), b"0123456789abcdefghij");
        assert_eq!(ranges.lock().unwrap().as_slice(), ["bytes=10-"]);
        assert_eq!(ctl.done.load(Ordering::SeqCst), 20);
        remove_files(&it);
        assert!(!it.path().exists());
    }

    #[test]
    fn cancel_stops_without_a_file() {
        let dirpath = std::env::temp_dir().join(format!("pa-dl-c-{}", std::process::id()));
        std::env::set_var("XDG_DATA_HOME", &dirpath);
        let (url, _) = server(b"abc");
        let c = client(url);
        let mut it = item("t2");
        let ctl = Control::default();
        ctl.want.store(CANCEL, Ordering::SeqCst);
        assert!(matches!(run(&c, &mut it, &ctl), Outcome::Canceled));
        assert!(!it.path().exists());
    }

    #[test]
    fn grouping_and_expiry() {
        let mut a = item("a");
        a.series_title = Some("Sample Series 1".into());
        a.season = Some(1);
        a.episode = Some(2);
        let mut b = a.clone();
        b.id = "b".into();
        b.episode = Some(1);
        let m = item("m");
        let all = [a.clone(), b, m];
        let g = grouped(&all);
        assert_eq!(g[0].0, None, "movies first");
        assert_eq!(g[1].0.as_deref(), Some("Sample Series 1"));
        assert_eq!(
            g[1].1[0].1.iter().map(|i| i.episode).collect::<Vec<_>>(),
            [Some(1), Some(2)]
        );
        a.state = State::Completed;
        a.keep_until = Some(100);
        assert!(a.expired(100) && !a.expired(99));
        assert_eq!(human_size(1_500_000_000), "1.5 GB");
        assert_eq!(item("x").percent(), 0);
    }
}
