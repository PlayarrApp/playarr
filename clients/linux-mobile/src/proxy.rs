//! Loopback playback proxy. The server wants `Authorization: Bearer` on every media request, including each
//! HLS playlist and segment, and GStreamer's adaptive demuxers do not forward custom headers to the sources
//! they create. The player therefore reads `http://127.0.0.1:<port>/<server path>` and this proxy adds the
//! token and forwards byte ranges. Only the playback client's own process can reach the loopback port.
use crate::api::Client;
use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};

pub struct Proxy {
    pub port: u16,
}

impl Proxy {
    pub fn start(client: Client) -> std::io::Result<Proxy> {
        let l = TcpListener::bind("127.0.0.1:0")?;
        let port = l.local_addr()?.port();
        std::thread::spawn(move || {
            for conn in l.incoming().flatten() {
                let c = client.clone();
                std::thread::spawn(move || {
                    let _ = handle(conn, &c);
                });
            }
        });
        Ok(Proxy { port })
    }

    /// Local URL for a server-relative (or absolute) playback URL.
    pub fn local_url(&self, url: &str) -> String {
        format!("http://127.0.0.1:{}{}", self.port, path_and_query(url))
    }
}

/// Strips scheme and host from an absolute URL, leaving the path and query.
pub fn path_and_query(url: &str) -> String {
    match url.find("://") {
        Some(i) => match url[i + 3..].find('/') {
            Some(j) => url[i + 3 + j..].to_string(),
            None => "/".into(),
        },
        None => url.to_string(),
    }
}

fn handle(mut conn: TcpStream, client: &Client) -> std::io::Result<()> {
    let mut rd = BufReader::new(conn.try_clone()?);
    let mut line = String::new();
    rd.read_line(&mut line)?;
    let mut parts = line.split_whitespace();
    let (method, path) = (parts.next().unwrap_or(""), parts.next().unwrap_or("/").to_string());
    let mut range = None;
    loop {
        let mut h = String::new();
        if rd.read_line(&mut h)? == 0 || h == "\r\n" || h == "\n" {
            break;
        }
        if let Some((k, v)) = h.split_once(':') {
            if k.eq_ignore_ascii_case("range") {
                range = Some(v.trim().to_string());
            }
        }
    }
    if method != "GET" || !path.starts_with("/api/") {
        return conn.write_all(b"HTTP/1.1 405 Method Not Allowed\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
    }
    match client.stream(&path, range.as_deref()) {
        Ok(mut resp) => {
            let status = resp.status();
            let mut head = format!(
                "HTTP/1.1 {} {}\r\n",
                status.as_u16(),
                status.canonical_reason().unwrap_or("")
            );
            for name in ["content-type", "content-length", "content-range", "accept-ranges"] {
                if let Some(v) = resp.headers().get(name).and_then(|v| v.to_str().ok()) {
                    head.push_str(&format!("{name}: {v}\r\n"));
                }
            }
            head.push_str("Connection: close\r\n\r\n");
            conn.write_all(head.as_bytes())?;
            std::io::copy(&mut resp.body_mut().as_reader(), &mut conn)?;
            Ok(())
        }
        Err(crate::api::ApiError::Http(c)) => {
            conn.write_all(format!("HTTP/1.1 {c} Error\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").as_bytes())
        }
        Err(_) => conn.write_all(b"HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_origin() {
        assert_eq!(path_and_query("https://h.example/api/v1/x?y=1"), "/api/v1/x?y=1");
        assert_eq!(path_and_query("/api/v1/x"), "/api/v1/x");
    }
}
