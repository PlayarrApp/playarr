"""Unix-socket protocol between the vidaa CLI and the keepalive broker (stdlib only).

One JSON object per line each way. Request {"op": ..., ...args}; reply {"ok": true, "result": <text>} or
{"ok": false, "error": <text>}. The broker owns the single MQTT session to the TV; callers that cannot reach it
(socket missing or refused) get None from call() and connect directly instead.
"""
import json
import os
import socket
import socketserver
from pathlib import Path

# The installed copy sits in <data>/scripts/vidaa/, so parents[2] is the data dir when PLAYARR_DATA_DIR is unset.
DATA = Path(os.environ.get("PLAYARR_DATA_DIR") or Path(__file__).resolve().parents[2])


def sock_path():
    return os.environ.get("VIDAA_SOCK") or str(DATA / "vidaa.sock")


def call(req, path=None, timeout=180):
    """Send one request to the broker. None means no broker is listening (caller falls back to a direct session)."""
    s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    s.settimeout(timeout)
    try:
        s.connect(path or sock_path())
    except (FileNotFoundError, ConnectionRefusedError):
        s.close()
        return None
    with s:
        s.sendall(json.dumps(req).encode() + b"\n")
        buf = b""
        while not buf.endswith(b"\n"):
            chunk = s.recv(65536)
            if not chunk:
                raise ConnectionError("broker closed the connection without a reply")
            buf += chunk
    return json.loads(buf)


def serve(path, handler):
    """Listen on `path` (mode 0600) in a background thread. handler(req) returns the result text or raises (SystemExit text counts)."""
    class H(socketserver.StreamRequestHandler):
        def handle(self):
            try:
                reply = {"ok": True, "result": handler(json.loads(self.rfile.readline(1 << 20)))}
            except SystemExit as e:
                reply = {"ok": False, "error": str(e.code)}
            except Exception as e:
                reply = {"ok": False, "error": f"{type(e).__name__}: {e}"}
            self.wfile.write(json.dumps(reply).encode() + b"\n")

    class Server(socketserver.ThreadingUnixStreamServer):
        daemon_threads = True

    Path(path).unlink(missing_ok=True)  # stale socket from a previous run
    server = Server(path, H)
    os.chmod(path, 0o600)
    import threading
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server
