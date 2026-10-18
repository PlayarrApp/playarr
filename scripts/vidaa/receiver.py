#!/usr/bin/env python3
"""VIDAA debug-mirror receiver (test tooling for scripts/parity/drivers/vidaa.mjs).

Serves the debug build (static, SPA fallback) and accepts frames. Frame endpoints need the token
(PLAYARR_VIDAA_MIRROR_TOKEN from ~/.secrets) as ?t=. Keeps only the latest KEEP frames and drops
anything older than MAX_AGE_S. Never prints the token.
Run: MIRROR_DIST=<dist-debug-mirror> MIRROR_RECOVERY_DATA=<scratch dir> [MIRROR_PORT=18742] python3 -I receiver.py
"""
import base64, json, mimetypes, os, re, sys, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs

HERE = Path(__file__).resolve().parent
def required_dir(name):
    value = os.environ.get(name)
    if not value:
        sys.exit(name + " must name a local scratch directory")
    return Path(value).resolve()


DIST = required_dir("MIRROR_DIST")  # the debug-mirror build (clients/tv-web/web/dist-debug-mirror)
RECOVERY_DATA = required_dir("MIRROR_RECOVERY_DATA")
FRAMES = Path(os.environ.get("MIRROR_FRAMES_DIR", RECOVERY_DATA / "frames")).resolve()
FRAMES.mkdir(parents=True, exist_ok=True)
PORT = int(os.environ.get("MIRROR_PORT", "18742"))
HOST = os.environ.get("MIRROR_HOST", "0.0.0.0")
TOKEN = ""
for line in (Path.home() / ".secrets").read_text().splitlines():
    if line.startswith("PLAYARR_VIDAA_MIRROR_TOKEN="):
        TOKEN = line.split("=", 1)[1].strip().strip("\"'")
if not TOKEN:
    sys.exit("PLAYARR_VIDAA_MIRROR_TOKEN missing")
lock = threading.Lock()
STATS_LOCK = threading.Lock()
STATS = {}
LAST_FRAME_DIAGNOSTIC = {}
HEARTBEAT = {}
LAST_KEYS = []
RECOVERY_CODE = ""
RECOVERY_CODE_AT = 0
IDENTITY_STATUS = {}
RECOVERY_STATE = {}
RECOVERY_LOCK = threading.Lock()
RECOVERY_JS = Path(__file__).with_name("recovery_collector.js").read_text()



def count_stat(name):
    with STATS_LOCK:
        STATS[name] = STATS.get(name, 0) + 1


def stats_snapshot():
    with STATS_LOCK:
        return dict(STATS)


def identity_rejection(identity, secrets, now_ms=None):
    """Return a fixed diagnostic category using the same fail-closed identity policy."""
    now_ms = int(time.time() * 1000) if now_ms is None else now_ms
    if not isinstance(identity, dict):
        return "identity_missing"
    if identity.get("status") != "ok":
        status = identity.get("status")
        return status if status in {
            "trusted_server_unavailable", "allowlist_unavailable", "session_unavailable",
            "session_ambiguous", "untrusted_server", "profile_request_failed", "session_changed",
            "profile_response_invalid", "current_profile_missing_or_ambiguous", "identity_unavailable",
            "not_allowlisted",
        } else "identity_status_invalid"
    if identity.get("sessionChanged") is not False:
        return "session_changed"
    if identity.get("isCurrentCount") != 1:
        return "current_profile_count"
    allow = {secrets.get(k, "").strip() for k in (
        "PLAYARR_DEVICE_TEST_USERNAME", "PLAYARR_DEVICE_TEST_DPAD_USERNAME")}
    allow.discard("")
    if identity.get("username") not in allow:
        return "username_not_allowlisted"
    trusted = secrets.get("PLAYARR_DEVICE_TEST_SERVER_URL", "").rstrip("/")
    if not trusted:
        return "trusted_server_unavailable"
    if identity.get("serverUrl") != trusted:
        return "server_mismatch"
    checked = identity.get("checkedAt")
    if not isinstance(checked, (int, float)):
        return "identity_timestamp_missing"
    if checked > now_ms:
        return "identity_timestamp_future"
    if now_ms - checked > 5000:
        return "identity_timestamp_stale"
    return "accepted"


def identity_allowed(identity, secrets, now_ms=None):
    """Pure fail-closed validator for the authenticated profile projection."""
    now_ms = int(time.time() * 1000) if now_ms is None else now_ms
    allow = {secrets.get(k, "").strip() for k in (
        "PLAYARR_DEVICE_TEST_USERNAME", "PLAYARR_DEVICE_TEST_DPAD_USERNAME")}
    allow.discard("")
    trusted = secrets.get("PLAYARR_DEVICE_TEST_SERVER_URL", "").rstrip("/")
    if not isinstance(identity, dict):
        return False
    checked = identity.get("checkedAt")
    return bool(
        identity.get("status") == "ok"
        and identity.get("sessionChanged") is False
        and identity.get("isCurrentCount") == 1
        and identity.get("username") in allow
        and bool(trusted)
        and identity.get("serverUrl") == trusted
        and isinstance(checked, (int, float))
        and checked <= now_ms
        and now_ms - checked <= 5000
    )


class H(BaseHTTPRequestHandler):
    server_version = "mirror"

    def log_message(self, fmt, *a):
        # Static-asset requests only (never the token query): shows which build the TV loaded.
        line = self.requestline.split("?")[0] if getattr(self, "requestline", "") else ""
        if "/assets/" in line or "sw.js" in line or line.endswith(" /series") or "/calendar" in line:
            sys.stderr.write(line + "\n"); sys.stderr.flush()

    def _ok(self, code, body=b"", ctype="application/json", extra=()):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        for k, v in extra:
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _authed(self):
        q = parse_qs(urlparse(self.path).query)
        return q.get("t", [""])[0] == TOKEN

    def _proxy_image(self, target):
        # Same-origin artwork proxy for captures: public https hosts only, image content types only, 4 MB cap.
        import ipaddress, socket, urllib.request
        try:
            t = urlparse(target)
            if t.scheme != "https" or not t.hostname:
                raise ValueError("scheme")
            for info in socket.getaddrinfo(t.hostname, t.port or 443, type=socket.SOCK_STREAM):
                if not ipaddress.ip_address(info[4][0]).is_global:
                    raise ValueError("host")
            req = urllib.request.Request(target, headers={"User-Agent": "playarr-mirror-proxy"})
            with urllib.request.urlopen(req, timeout=10) as r:
                ctype = r.headers.get("Content-Type", "")
                if not ctype.startswith("image/"):
                    raise ValueError("type")
                data = r.read(4_000_001)
            if len(data) > 4_000_000:
                raise ValueError("size")
        except Exception:
            return self._ok(502, b"{}")
        return self._ok(200, data, ctype)

    def do_OPTIONS(self):
        self._ok(204, extra=[("Access-Control-Allow-Headers", "Content-Type"), ("Access-Control-Allow-Methods", "GET,POST")])

    def do_POST(self):
        path = urlparse(self.path).path
        if path == "/__mirror/heartbeat":
            # Small, frequent identity verification from the TV page, independent of the slow frames.
            if not self._authed():
                return self._ok(403, b'{"error":"token"}')
            n = int(self.headers.get("Content-Length", "0"))
            if n <= 0 or n > 2048:
                return self._ok(413, b"{}")
            try:
                data = json.loads(self.rfile.read(n))
            except ValueError:
                return self._ok(400, b"{}")
            now_ms = int(time.time() * 1000)
            checked = data.get("checkedAt") if isinstance(data, dict) else None
            if not isinstance(checked, (int, float)) or checked > now_ms or now_ms - checked > 5000:
                count_stat("heartbeat_rejected_stale")
                return self._ok(400, b'{"error":"stale_heartbeat"}')
            keep = {k: data.get(k) for k in ("status", "username", "isCurrentCount", "serverUrl", "checkedAt", "sessionChanged")}
            global HEARTBEAT
            with STATS_LOCK:
                HEARTBEAT = {"identity": keep, "receivedAt": time.time()}
            count_stat("heartbeat_accepted")
            return self._ok(204)
        if path == "/__mirror/identity-status":
            if not self._authed():
                return self._ok(403, b'{"error":"token"}')
            n = int(self.headers.get("Content-Length", "0"))
            if n <= 0 or n > 2048:
                return self._ok(413, b"{}")
            try:
                data = json.loads(self.rfile.read(n))
            except ValueError:
                return self._ok(400, b"{}")
            statuses = {
                "trusted_server_unavailable", "allowlist_unavailable", "session_unavailable",
                "session_ambiguous", "untrusted_server", "profile_request_failed", "session_changed",
                "profile_response_invalid", "current_profile_missing_or_ambiguous", "identity_unavailable",
                "not_allowlisted", "ok",
            }
            if not isinstance(data, dict) or data.get("status") not in statuses:
                count_stat("identity_status_post_invalid")
                return self._ok(400, b'{"error":"invalid_identity_status"}')
            count_stat("identity_report_" + data["status"])
            checked = data.get("checkedAt")
            if not isinstance(checked, (int, float)) or checked > int(time.time() * 1000) or int(time.time() * 1000) - checked > 5000:
                count_stat("identity_status_post_stale_timestamp")
                return self._ok(400, b'{"error":"stale_identity_status"}')
            summary = {
                "status": data["status"],
                "checkedAt": int(checked),
                "ageMs": max(0, int(time.time() * 1000) - int(checked)),
                "sessionChanged": data.get("sessionChanged") is True,
                "isCurrentCount": data.get("isCurrentCount") if data.get("isCurrentCount") in (0, 1) else 0,
                "usernameAllowed": data.get("usernameAllowed") is True,
                "serverMatched": data.get("serverMatched") is True,
                "markerPresent": data.get("markerPresent") is True,
                "sessionsArray": data.get("sessionsArray") is True,
                "markerRawChanged": data.get("markerRawChanged") is True,
                "sessionsRawChanged": data.get("sessionsRawChanged") is True,
                "selectedIdentityChanged": data.get("selectedIdentityChanged") is True,
                "selectedCredentialsChanged": data.get("selectedCredentialsChanged") is True,
            }
            global IDENTITY_STATUS
            IDENTITY_STATUS = summary
            count_stat("identity_status_post_accepted")
            return self._ok(204)
        if path == "/__mirror/recovery-state":
            if not self._authed():
                return self._ok(403, b'{"error":"token"}')
            n = int(self.headers.get("Content-Length", "0"))
            if n <= 0 or n > 1024:
                return self._ok(413, b"{}")
            try:
                data = json.loads(self.rfile.read(n))
            except ValueError:
                return self._ok(400, b"{}")
            keys = ("markerPresent", "sessionsArray", "loginOptionsPresent", "busy",
                    "verificationUriAllowed", "codeFormatValid", "codeSubmitted", "loginErrorPresent")
            if not isinstance(data, dict) or any(not isinstance(data.get(k), bool) for k in keys):
                return self._ok(400, b'{"error":"invalid_recovery_state"}')
            global RECOVERY_STATE
            RECOVERY_STATE = {k: data[k] for k in keys}
            RECOVERY_STATE.update(checkedAt=int(time.time() * 1000))
            return self._ok(204)
        if path == "/__mirror/recovery-code":
            if not self._authed():
                return self._ok(403, b'{"error":"token"}')
            n = int(self.headers.get("Content-Length", "0"))
            if n <= 0 or n > 2048:
                return self._ok(413, b"{}")
            try:
                d = json.loads(self.rfile.read(n))
            except ValueError:
                return self._ok(400, b"{}")
            code = d.get("code") if isinstance(d, dict) else None
            if (not isinstance(d, dict) or d.get("kind") != "hosted-device-login" or d.get("signedOut") is not True
                    or d.get("verificationOrigin") != "https://playarr.app"
                    or d.get("verificationPath") != "/link"
                    or not isinstance(code, str) or not re.fullmatch(r"[A-Z0-9]{4}-[A-Z0-9]{4}", code)):
                return self._ok(400, b'{"error":"invalid_recovery_metadata"}')
            global RECOVERY_CODE, RECOVERY_CODE_AT
            with RECOVERY_LOCK:
                RECOVERY_CODE, RECOVERY_CODE_AT = code, time.time()
            return self._ok(204)
        if path != "/__mirror/frame":
            return self._ok(404, b"{}")
        count_stat("frame_post_received")
        arrival_ms = int(time.time() * 1000)  # identity freshness is judged when the upload starts: a 1 MB PNG takes seconds on the TV
        if not self._authed():
            count_stat("frame_post_rejected_auth")
            return self._ok(403, b'{"error":"token"}')
        n = int(self.headers.get("Content-Length", "0"))
        if n <= 0 or n > 24_000_000:
            return self._ok(413, b"{}")
        try:
            d = json.loads(self.rfile.read(n))
        except ValueError:
            return self._ok(400, b"{}")
        identity = d.get("identity") if isinstance(d, dict) else None
        now_ms = arrival_ms
        checked_at = identity.get("checkedAt") if isinstance(identity, dict) else None
        capture_ms = d.get("captureMs") if isinstance(d, dict) else None
        diagnostic = {
            "identityAgeAtArrivalMs": now_ms - checked_at if isinstance(checked_at, (int, float)) else None,
            "captureMs": capture_ms if isinstance(capture_ms, (int, float)) else None,
            "requestDurationMs": d.get("requestDurationMs") if isinstance(d, dict) and isinstance(d.get("requestDurationMs"), (int, float)) else None,
        }
        global LAST_FRAME_DIAGNOSTIC
        with STATS_LOCK:
            LAST_FRAME_DIAGNOSTIC = diagnostic
        secrets = {}
        for line in (Path.home() / ".secrets").read_text().splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                key, value = line.split("=", 1)
                secrets[key.strip()] = value.strip().strip("\"'")
        reason = identity_rejection(identity, secrets, now_ms)
        if reason != "accepted" or not identity_allowed(identity, secrets, now_ms):
            count_stat("frame_post_rejected_" + reason)
            return self._ok(403, b'{"error":"device_test_account_guard"}')
        img = d.pop("image", None)
        stem = "frame-%013d" % int(time.time() * 1000)
        with lock:
            if isinstance(img, str) and (img.startswith("data:image/jpeg;base64,") or img.startswith("data:image/png;base64,")):
                # PNG frames are stored under the .jpg name too (the consumers read latest.jpg); the content type is sniffed on read
                (FRAMES / (stem + ".jpg")).write_bytes(base64.b64decode(img.split(",", 1)[1]))
                d["hasImage"] = True
            else:
                d["hasImage"] = False
            ks = (d.get("env") or {}).get("keys") or []
            global LAST_KEYS
            if ks != LAST_KEYS:  # append key events the page saw since the previous frame (kept across page reloads)
                new = ks[len(LAST_KEYS):] if ks[:len(LAST_KEYS)] == LAST_KEYS else ks
                with open(RECOVERY_DATA / "keys.log", "a") as kf:
                    for k in new:
                        kf.write("%s %s\n" % (time.strftime("%H:%M:%S"), k))
                LAST_KEYS = ks
            d["receivedAt"] = time.time()
            (FRAMES / (stem + ".json")).write_text(json.dumps(d))
        count_stat("frame_post_accepted")
        self._ok(200, b'{"ok":true}')

    def do_GET(self):
        global RECOVERY_CODE, RECOVERY_CODE_AT
        u = urlparse(self.path)
        if u.path == "/__mirror/recovery.js":
            return self._ok(200, RECOVERY_JS.encode(), "application/javascript")
        if u.path.startswith("/__mirror/"):
            if not self._authed():
                return self._ok(403, b'{"error":"token"}')
            if u.path == "/__mirror/heartbeat.json":
                with STATS_LOCK:
                    hb = dict(HEARTBEAT)
                return self._ok(200, json.dumps(hb).encode())
            if u.path == "/__mirror/img":
                return self._proxy_image(parse_qs(u.query).get("u", [""])[0])
            if u.path == "/__mirror/diagnostics":
                with RECOVERY_LOCK:
                    identity = dict(IDENTITY_STATUS) if IDENTITY_STATUS else {"status": "unavailable"}
                with STATS_LOCK:
                    frame = dict(LAST_FRAME_DIAGNOSTIC)
                return self._ok(200, json.dumps({"counts": stats_snapshot(), "identity": identity, "lastFrame": frame}).encode())
            if u.path == "/__mirror/trusted":
                secrets = {}
                for line in (Path.home() / ".secrets").read_text().splitlines():
                    if "=" in line and not line.lstrip().startswith("#"):
                        key, value = line.split("=", 1)
                        secrets[key.strip()] = value.strip().strip("\"'")
                server = secrets.get("PLAYARR_DEVICE_TEST_SERVER_URL", "").rstrip("/")
                if not server.startswith(("https://", "http://")):
                    return self._ok(503, b'{"error":"identity_configuration"}')
                allowed = [secrets.get(k, "").strip() for k in ("PLAYARR_DEVICE_TEST_USERNAME", "PLAYARR_DEVICE_TEST_DPAD_USERNAME") if secrets.get(k, "").strip()]
                if not allowed:
                    return self._ok(503, b'{"error":"identity_allowlist_unavailable"}')
                return self._ok(200, json.dumps({"serverUrl": server, "allowedUsernames": allowed}).encode())
            if u.path == "/__mirror/identity-status":
                return self._ok(200, json.dumps(IDENTITY_STATUS or {"status": "unavailable"}).encode())
            if u.path == "/__mirror/recovery-state":
                data = dict(RECOVERY_STATE) if RECOVERY_STATE else {"status": "unavailable"}
                if "checkedAt" in data:
                    data["ageMs"] = max(0, int(time.time() * 1000) - data["checkedAt"])
                return self._ok(200, json.dumps(data).encode())
            if u.path == "/__mirror/recovery-code":
                with RECOVERY_LOCK:
                    if not RECOVERY_CODE or time.time() - RECOVERY_CODE_AT > 600:
                        return self._ok(404, b'{"error":"recovery_code_unavailable"}')
                    code = RECOVERY_CODE
                    RECOVERY_CODE = ""
                    RECOVERY_CODE_AT = 0
                return self._ok(200, json.dumps({"code": code}).encode())
            metas = sorted(FRAMES.glob("frame-*.json"))
            if u.path == "/__mirror/latest.json":
                return self._ok(200, metas[-1].read_bytes() if metas else b"{}")
            if u.path == "/__mirror/latest.jpg":
                for m in reversed(metas):
                    j = m.with_suffix(".jpg")
                    if j.exists():
                        b = j.read_bytes(); return self._ok(200, b, "image/png" if b[:4] == b"\x89PNG" else "image/jpeg")
                return self._ok(404, b"")
            return self._ok(404, b"{}")
        rel = u.path.lstrip("/") or "index.html"
        f = (DIST / rel).resolve()
        try:
            f.relative_to(DIST)
            contained = True
        except ValueError:
            contained = False
        if not (contained and f.is_file()):
            f = DIST / "index.html"  # SPA fallback
        ctype = mimetypes.guess_type(str(f))[0] or "application/octet-stream"
        body = f.read_bytes()
        if f.name == "index.html" and b"</body>" in body:
            body = body.replace(b"</body>", b'<script src="/__mirror/recovery.js"></script></body>', 1)
        self._ok(200, body, ctype)


if __name__ == "__main__":
    ThreadingHTTPServer((HOST, PORT), H).serve_forever()
