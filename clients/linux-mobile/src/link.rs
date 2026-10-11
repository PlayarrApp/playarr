//! Hosted link broker (QR / device-code) sign-in, as the other native clients do it:
//! broker code -> phone approves and picks a profile -> broker claim -> server token exchange.
use crate::api::{agent, ApiError, Result, BROKER_PLATFORM};
use crate::model::{Claim, DeviceCode, Tokens};

pub fn broker_origin() -> String {
    std::env::var("PLAYARR_BROKER").unwrap_or_else(|_| "https://playarr.app".into())
}

pub enum Poll {
    Pending,
    Expired,
    Claimed(Claim),
}

/// `PLAYARR_BROKER_PLATFORM` overrides the identity for testing against a broker that does not know ours yet.
pub fn request_code(origin: &str) -> Result<DeviceCode> {
    let platform = std::env::var("PLAYARR_BROKER_PLATFORM").unwrap_or_else(|_| BROKER_PLATFORM.into());
    let mut r = agent()
        .post(&format!("{origin}/api/link/code"))
        .send_json(serde_json::json!({ "client_platform": platform }))?;
    let c = r.status().as_u16();
    if c != 200 {
        return Err(ApiError::Http(c));
    }
    r.body_mut().read_json().map_err(|e| ApiError::Decode(e.to_string()))
}

pub fn poll(origin: &str, device_code: &str) -> Result<Poll> {
    let mut r = agent()
        .get(&format!("{origin}/api/link/code/{}", crate::api::urlenc(device_code)))
        .call()?;
    match r.status().as_u16() {
        202 => Ok(Poll::Pending),
        404 => Ok(Poll::Expired),
        200 => {
            let c: Claim = r.body_mut().read_json().map_err(|e| ApiError::Decode(e.to_string()))?;
            if c.server_url.is_empty() || c.server_device_code.is_empty() {
                return Err(ApiError::Decode("empty claim".into()));
            }
            Ok(Poll::Claimed(c))
        }
        c => Err(ApiError::Http(c)),
    }
}

/// Redeems the claim's server device code for tokens. The approver already authorised it, so one
/// call normally succeeds; `authorization_pending` is retried a few times.
pub fn exchange(claim: &Claim) -> Result<Tokens> {
    let body = serde_json::json!({
        "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
        "device_code": claim.server_device_code,
    });
    let url = format!("{}/api/v1/oauth/token", claim.server_url.trim_end_matches('/'));
    for _ in 0..10 {
        let mut r = agent().post(&url).send_json(&body)?;
        match r.status().as_u16() {
            200 => return r.body_mut().read_json().map_err(|e| ApiError::Decode(e.to_string())),
            400 => std::thread::sleep(std::time::Duration::from_secs(2)),
            c => return Err(ApiError::Http(c)),
        }
    }
    Err(ApiError::Http(400))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;

    /// One-shot HTTP server answering each connection with the next canned response.
    fn serve(responses: Vec<&'static str>) -> String {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = l.local_addr().unwrap();
        std::thread::spawn(move || {
            for r in responses {
                let (mut s, _) = l.accept().unwrap();
                let mut buf = [0u8; 4096];
                let _ = s.read(&mut buf);
                let _ = s.write_all(r.as_bytes());
            }
        });
        format!("http://{addr}")
    }

    fn http(status: &str, body: &str) -> &'static str {
        Box::leak(format!("HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).into_boxed_str())
    }

    #[test]
    fn code_poll_claim_flow() {
        let origin = serve(vec![
            http(
                "200 OK",
                r#"{"device_code":"AB.cd","user_code":"ABCD-2345","verification_uri":"u","verification_uri_complete":"u?c=1","expires_in":300,"interval":2}"#,
            ),
            http("202 Accepted", r#"{"error":"authorization_pending"}"#),
            http(
                "200 OK",
                r#"{"user_code":"ABCD-2345","server_url":"http://s","server_device_code":"0123456789abcdef","server_urls":["http://s"]}"#,
            ),
            http("404 Not Found", r#"{"error":"expired_token"}"#),
        ]);
        let code = request_code(&origin).unwrap();
        assert_eq!(code.user_code, "ABCD-2345");
        assert!(matches!(poll(&origin, &code.device_code).unwrap(), Poll::Pending));
        match poll(&origin, &code.device_code).unwrap() {
            Poll::Claimed(c) => assert_eq!(c.server_url, "http://s"),
            _ => panic!("expected claim"),
        }
        assert!(matches!(poll(&origin, &code.device_code).unwrap(), Poll::Expired));
    }

    #[test]
    fn exchange_retries_pending_then_succeeds() {
        let server = serve(vec![
            http("400 Bad Request", r#"{"error":"authorization_pending"}"#),
            http(
                "200 OK",
                r#"{"access_token":"a","refresh_token":"r","token_type":"Bearer","expires_in":3600}"#,
            ),
        ]);
        let claim = Claim {
            server_url: server,
            server_device_code: "x".into(),
            server_urls: vec![],
        };
        assert_eq!(exchange(&claim).unwrap().refresh_token, "r");
    }
}
