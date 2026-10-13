#!/usr/bin/env python3
"""Bridge for the DevEco Previewer (slot 7): frames to VNC, remote keys to the Previewer.

- Hosts the Previewer's command socket (/tmp/<name>_commandPipe); the Previewer connects to it as a client.
- Reads JPEG frames from the Previewer websocket (127.0.0.1:<ws>).
- Serves VNC through sim_vnc.Server (RFB 3.8, VNC auth, Tight/JPEG) on --bind:--port (tailnet only).
- Local control on 127.0.0.1:<ctl>: GET /shot (jpeg), /key/<up|down|left|right|ok|back|space>, /click?x=&y=, POST /cmd.
Standard library only. Password from the environment (PLAYARR_VNC_SLOT7_PASSWORD), never the command line.
"""
from __future__ import annotations

import argparse
import base64
import http.server
import json
import math
import os
import socket
import struct
import sys
import threading
import time
import urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sim_vnc  # noqa: E402  (copied next to this file from scripts/sim-vnc)

# OpenHarmony KeyCode values (range the Previewer accepts: 2000-2119)
OH_KEYS = {"up": 2012, "down": 2013, "left": 2014, "right": 2015, "ok": 2054, "center": 2016, "space": 2050, "esc": 2070, "tab": 2049, "enter": 2054, "pagedown": 2020}
KEYSYM = {0xFF52: "up", 0xFF54: "down", 0xFF51: "left", 0xFF53: "right", 0xFF0D: "ok", 0xFF8D: "ok",
          0x0020: "space", 0xFF1B: "back", 0xFF08: "back"}


# Preview-only route mailbox: the capture scripts set a route name, the patched Index polls and consumes it.
ROUTE_BOX = {"name": ""}
# Parity state the patched app reports (route, library kind, last focused item); GET /state returns it with the derived label.
IMAGES: dict = {}  # id -> bytes, posted by the patched app (the Previewer cannot decode images itself)
STATE = {"route": "", "kind": "", "focused": None, "lib_kind": ""}
DEBUG_SEQUENCE = 0
DETAIL_IMAGE_STAGES = {
    "source", "fetch-start", "fetch-ok", "fetch-error", "bridge-source-ready",
    "assigned", "image-source", "image-area-positive", "image-area-zero", "on-complete", "on-error",
    "row-match-found", "row-match-missing", "poster-artwork-prop-undefined", "poster-artwork-prop-present",
    "poster-render-artwork-undefined", "poster-render-artwork-present",
    "visible-item-stamp-absent", "visible-item-stamp-present",
}
DETAIL_LAYOUT_STAGES = {
    "detail-rails-count", "rail-items-count", "rail-item-appear",
    "rail-items-prop-update-count", "rail-items-prop-update-artwork-count",
    "poster-card-root-area", "poster-card-art-area", "rail-list-area",
    "rail-list-height-explicit", "rail-list-height-default-fill",
}


def append_debug_event(category: str, *, route: str = "", work_id: str = "", parent_work_id: str = "",
                       row_id: str = "", generation: int = 0) -> None:
    global DEBUG_SEQUENCE
    DEBUG_SEQUENCE += 1
    event = {
        "sequence": DEBUG_SEQUENCE,
        "category": category,
        "timestamp": time.monotonic(),
        "route": route or STATE.get("route", ""),
        "work_id": work_id or STATE.get("work_id", ""),
        "generation": generation or STATE.get("route_generation", 0),
    }
    if parent_work_id and row_id:
        event["parent_work_id"] = parent_work_id
        event["row_id"] = row_id
    STATE["debug_events"] = (STATE.get("debug_events", []) + [event])[-300:]
    STATE["debug_sequence"] = DEBUG_SEQUENCE


def append_row_image_event(body: dict) -> bool:
    route = str(body.get("route", ""))
    work_id = str(body.get("work_id", ""))
    parent_work_id = str(body.get("parent_work_id", ""))
    row_id = str(body.get("row_id", ""))
    try:
        generation = int(body.get("generation", 0))
    except (TypeError, ValueError):
        return False
    if route != "Detail" or not work_id or work_id != parent_work_id or not row_id or generation <= 0:
        return False
    current_generation = STATE.get("route_generation", 0)
    if generation < current_generation:
        return False
    if (generation == current_generation and current_generation > 0
            and (STATE.get("route") != route or STATE.get("work_id") != work_id)):
        return False
    append_debug_event("detail-row-image-complete", route=route, work_id=work_id,
                       parent_work_id=parent_work_id, row_id=row_id, generation=generation)
    return True


def append_detail_image_stage(body: dict) -> bool:
    """Accept a scoped preview-only image stage without exposing IDs in logs/artifacts."""
    route = str(body.get("route", ""))
    work_id = str(body.get("work_id", ""))
    parent_work_id = str(body.get("parent_work_id", ""))
    row_id = str(body.get("row_id", ""))
    stage = str(body.get("stage", ""))
    try:
        generation = int(body.get("generation", 0))
    except (TypeError, ValueError):
        return False
    if (route != "Detail" or not work_id or work_id != parent_work_id or not row_id
            or generation <= 0 or stage not in DETAIL_IMAGE_STAGES):
        return False
    current_generation = STATE.get("route_generation", 0)
    if generation < current_generation:
        return False
    if (generation == current_generation and current_generation > 0
            and (STATE.get("route") != route or STATE.get("work_id") != work_id)):
        return False
    append_debug_event("detail-row-image-" + stage, route=route, work_id=work_id,
                       parent_work_id=parent_work_id, row_id=row_id, generation=generation)
    return True


def append_detail_layout_stage(body: dict) -> bool:
    """Accept only scoped layout stages and numeric measurements."""
    route = str(body.get("route", ""))
    work_id = str(body.get("work_id", ""))
    stage = str(body.get("stage", ""))
    try:
        generation = int(body.get("generation", 0))
    except (TypeError, ValueError):
        return False
    if route != "Detail" or not work_id or generation <= 0 or stage not in DETAIL_LAYOUT_STAGES:
        return False
    current_generation = STATE.get("route_generation", 0)
    if generation < current_generation:
        return False
    if (generation == current_generation and current_generation > 0
            and (STATE.get("route") != route or STATE.get("work_id") != work_id)):
        return False
    numeric = {}
    for field in ("value", "width", "height"):
        raw = body.get(field)
        if raw is None:
            continue
        if (isinstance(raw, bool) or not isinstance(raw, (int, float))
                or (isinstance(raw, float) and not math.isfinite(raw)) or raw < -1):
            return False
        if raw > 1000000:
            return False
        if raw >= 0:
            numeric[field] = raw
    if "width" in numeric and "height" in numeric:
        numeric["area"] = numeric["width"] * numeric["height"]
    append_debug_event("detail-layout-" + stage, route=route, work_id=work_id, generation=generation)
    STATE["debug_events"][-1].update(numeric)
    return True


def apply_state(q):
    if "route" in q:
        route = q["route"][0]
        work_id = q.get("work", [""])[0] if route == "Detail" else ""
        try:
            generation = int(q.get("generation", ["0"])[0])
        except (TypeError, ValueError):
            generation = 0
        if "generation" in q and generation < STATE.get("route_generation", 0):
            return
        STATE["route"] = route
        STATE["kind"] = q.get("kind", [""])[0]
        STATE["work_id"] = work_id
        STATE["route_generation"] = max(STATE.get("route_generation", 0), generation)
        if STATE["route"] == "Library":
            STATE["lib_kind"] = STATE["kind"]
    if "dbg" in q:
        STATE["dbg"] = q["dbg"][0]
        STATE.setdefault("dbglog", []).append(q["dbg"][0])
        del STATE["dbglog"][:-300]
        append_debug_event(q["dbg"][0].split(":", 1)[0][:64])
    if "nav" in q:
        STATE["focused"] = q["nav"][0]
    if "title" in q:
        title, sub = q["title"][0], q.get("sub", [""])[0]
        # web's accessible names: Home cards read "<title><subtitle>", grid cards "open <title>"
        STATE["focused"] = title + sub if STATE["route"] in ("Home", "") else "open " + title


def log(message: str) -> None:
    print(f"{time.strftime('%H:%M:%S')} {message}", flush=True)


class WinPipe:
    """Server end of a Windows named pipe (the Windows Previewer connects to \\\\.\\pipe\\<name>_commandPipe as a client).
    Message mode, overlapped I/O so a pending read never blocks a write. Same recv/sendall/close surface as a socket."""

    def __init__(self, name: str):
        import _winapi
        self.w = _winapi
        self.h = _winapi.CreateNamedPipe(
            name, _winapi.PIPE_ACCESS_DUPLEX | 0x40000000,  # FILE_FLAG_OVERLAPPED
            _winapi.PIPE_TYPE_MESSAGE | _winapi.PIPE_READMODE_MESSAGE | _winapi.PIPE_WAIT, 1, 1 << 20, 1 << 20, 0, 0)
        ov = _winapi.ConnectNamedPipe(self.h, overlapped=True)
        try:
            ov.GetOverlappedResult(True)
        except OSError as error:
            if error.winerror != 535:  # ERROR_PIPE_CONNECTED: the client was already there
                raise

    def recv(self, n: int) -> bytes:
        try:
            ov, err = self.w.ReadFile(self.h, n, overlapped=True)
            transferred, err = ov.GetOverlappedResult(True)
            return ov.getbuffer()[:transferred] if transferred else b""
        except OSError:
            return b""

    def sendall(self, data: bytes) -> None:
        ov, err = self.w.WriteFile(self.h, data, overlapped=True)
        ov.GetOverlappedResult(True)


class Commands:
    """The Previewer's command channel (we are the server; it connects once at start)."""

    def __init__(self, name: str):
        self.path = f"/tmp/{name}_commandPipe"
        self.conn = None
        self.lock = threading.Lock()
        self.last_reply = b""
        self.replied = threading.Event()
        if sys.platform == "win32":
            self.pipe_name = rf"\\.\pipe\{name}_commandPipe"
            self.server = None
        else:
            try:
                os.unlink(self.path)
            except FileNotFoundError:
                pass
            self.server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            self.server.bind(self.path)
            os.chmod(self.path, 0o600)
            self.server.listen(1)
        threading.Thread(target=self._accept, daemon=True).start()

    def _accept(self):
        while True:
            conn = self._wait_client()
            self.conn = conn
            log("previewer connected to the command socket")
            try:
                while True:
                    data = conn.recv(1 << 20)
                    if not data:
                        break
                    self.last_reply = (self.last_reply + data)[-(8 << 20):]
                    self.replied.set()
            except OSError:
                pass
            log("previewer left the command socket")
            self.conn = None

    def _wait_client(self):
        if self.server is not None:
            return self.server.accept()[0]
        return WinPipe(self.pipe_name)

    def send(self, command: str, args, kind: str = "action") -> bool:
        conn = self.conn
        if conn is None:
            return False
        payload = json.dumps({"type": kind, "command": command, "version": "1.0.1", "args": args}).encode()
        with self.lock:
            # The Previewer parses whatever one recv() returns as ONE JSON: two commands in one read wedge it.
            # Wait for this command's reply (every command answers) before the next one goes out.
            self.replied.clear()
            conn.sendall(payload)
            self.replied.wait(3)
            time.sleep(0.03)
        return True

    def key(self, name: str) -> bool:
        if name == "back":
            return self.send("BackClicked", None)
        code = OH_KEYS[name]
        ok = True
        for action in (0, 1):  # down, up: the release carries no pressed codes
            ok &= self.send("KeyPress", {"isInputMethod": False, "keyCode": code, "keyAction": action,
                                         "pressedCodes": [code] if action == 0 else [], "keyString": ""})
        return ok

    def key_long(self, name: str) -> bool:
        """Hold a key for about a second (down, wait, up)."""
        code = OH_KEYS[name]
        ok = self.send("KeyPress", {"isInputMethod": False, "keyCode": code, "keyAction": 0, "pressedCodes": [code], "keyString": ""})
        time.sleep(1.1)
        return ok & self.send("KeyPress", {"isInputMethod": False, "keyCode": code, "keyAction": 1, "pressedCodes": [code], "keyString": ""})

    def type_char(self, ch: str) -> bool:
        """One hardware key event; the Previewer inserts keyString (one action only, or it doubles)."""
        if ch.isalpha():
            code = 2017 + ord(ch.lower()) - ord("a")
        elif ch.isdigit():
            code = 2000 + int(ch)
        else:
            code = {".": 2044, ",": 2043, "/": 2064, "-": 2057, ":": 2062, ";": 2062, "@": 2065, "_": 2057,
                    " ": 2050, "=": 2058}.get(ch, 2062)
        pressed = [2047, code] if ch in ":_" or ch.isupper() else [code]  # 2047 = left shift
        return self.send("KeyPress", {"isInputMethod": False, "keyCode": code, "keyAction": 0,
                                      "pressedCodes": pressed, "keyString": ch})

    def clear_field(self, count: int = 80) -> bool:
        return all(self.send("KeyPress", {"isInputMethod": False, "keyCode": 2055, "keyAction": 0,
                                          "pressedCodes": [2055], "keyString": ""}) for _ in range(count))

    def hold(self, x: int, y: int, seconds: float = 1.3) -> bool:
        """A long press: press, wait, release."""
        ok = self.send("MousePress", {"x": x, "y": y})
        time.sleep(seconds)
        return ok and self.send("MouseRelease", {"x": x, "y": y})

    def click(self, x: int, y: int) -> bool:
        return self.send("MousePress", {"x": x, "y": y}) and self.send("MouseRelease", {"x": x, "y": y})

    def long_click(self, x: int, y: int) -> bool:
        """Press, hold for about 1.3 s (past the long-press threshold), release."""
        ok = self.send("MousePress", {"x": x, "y": y})
        time.sleep(1.3)
        return ok and self.send("MouseRelease", {"x": x, "y": y})


def ws_connect(port: int, path: str):
    """Client websocket handshake; returns (socket, leftover bytes)."""
    sock = socket.create_connection(("127.0.0.1", port), timeout=10)
    key = base64.b64encode(os.urandom(16)).decode()
    sock.sendall((f"GET /{path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                  f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n").encode())
    head = b""
    while b"\r\n\r\n" not in head:
        chunk = sock.recv(4096)
        if not chunk:
            raise ConnectionError("closed during handshake")
        head += chunk
    if b" 101 " not in head.split(b"\r\n", 1)[0]:
        raise ConnectionError(head.split(b"\r\n", 1)[0].decode("latin-1"))
    sock.settimeout(None)
    return sock, head.split(b"\r\n\r\n", 1)[1]


def ws_messages(sock, buf: bytes):
    """Yields complete (opcode, payload) messages from an unmasked server stream."""
    message, first = b"", 0

    def need(n):
        nonlocal buf
        while len(buf) < n:
            chunk = sock.recv(1 << 20)
            if not chunk:
                raise ConnectionError("websocket closed")
            buf += chunk

    while True:
        need(2)
        b0, b1 = buf[0], buf[1]
        length, off = b1 & 0x7F, 2
        if length == 126:
            need(4)
            length, off = struct.unpack(">H", buf[2:4])[0], 4
        elif length == 127:
            need(10)
            length, off = struct.unpack(">Q", buf[2:10])[0], 10
        need(off + length)
        payload, buf = buf[off:off + length], buf[off + length:]
        opcode = b0 & 0x0F
        if opcode == 8:
            raise ConnectionError("websocket close frame")
        if opcode in (0, 1, 2):
            if opcode:
                first = opcode
            message += payload
            if b0 & 0x80:
                yield first, message
                message = b""


def ws_send_text(sock, text: str) -> None:
    data, mask = text.encode(), os.urandom(4)
    head = bytes([0x81])
    if len(data) < 126:
        head += bytes([0x80 | len(data)])
    elif len(data) < 65536:
        head += bytes([0x80 | 126]) + struct.pack(">H", len(data))
    else:
        head += bytes([0x80 | 127]) + struct.pack(">Q", len(data))
    sock.sendall(head + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))


def run_ws(hub, port: int, sid: str):
    """Reads frames from the Previewer websocket; publishes the JPEG part of each message."""
    while True:
        try:
            sock, buf = ws_connect(port, sid)
            hub.source = "previewer-ws"
            log("websocket connected")
            for _, message in ws_messages(sock, buf):
                start = message.find(b"\xff\xd8")
                if start >= 0:
                    hub.publish(message[start:])
        except (OSError, ConnectionError) as error:
            log(f"websocket: {error}; retrying")
            time.sleep(2)


def run_debugger(port: int):
    """Debug-mode Previewer (needed so EntryAbility runs) waits for a debugger: attach, release it, stay attached."""
    while True:
        try:
            sock, buf = ws_connect(port, "")
            log("debugger attached")
            for i, method in enumerate(("Runtime.enable", "Debugger.enable", "Runtime.runIfWaitingForDebugger"), 1):
                ws_send_text(sock, json.dumps({"id": i, "method": method, "params": {}}))
            for opcode, message in ws_messages(sock, buf):
                if b'"Debugger.paused"' in message:
                    ws_send_text(sock, json.dumps({"id": 99, "method": "Debugger.resume", "params": {}}))
        except (OSError, ConnectionError) as error:
            log(f"debugger: {error}; retrying")
            time.sleep(1)


class PreviewKeys:
    sent = failed = 0

    def __init__(self, commands: Commands):
        self.commands = commands

    def press(self, name: str) -> None:
        if self.commands.key(name):
            self.sent += 1
        else:
            self.failed += 1


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--bind", required=True)
    parser.add_argument("--port", type=int, default=5907)
    parser.add_argument("--ws", type=int, default=40007)
    parser.add_argument("--ctl", type=int, default=40017)
    parser.add_argument("--sid", default="")
    parser.add_argument("--debug-port", type=int, default=40027)
    parser.add_argument("--cmd-name", default="playarr_cmd")
    parser.add_argument("--password-env", default="PLAYARR_VNC_SLOT7_PASSWORD")
    args = parser.parse_args()
    if args.bind in ("0.0.0.0", "::", ""):
        parser.error("--bind must be one interface address")

    commands = Commands(args.cmd_name)
    threading.Thread(target=run_debugger, args=(args.debug_port,), daemon=True).start()
    # VNC keysyms map to Previewer key names instead of tvOS HID usages
    sim_vnc.KEYSYM_TO_HID = KEYSYM
    vnc_args = argparse.Namespace(bind=args.bind, port=args.port, fps=30, password_env=args.password_env, ready_file="",
                                  metrics_file="", frame_file="", no_keys=True, udid="", idb="", source="auto")
    server = sim_vnc.Server(vnc_args)
    server.keys = PreviewKeys(commands)
    sim_vnc.start_frames = lambda hub, a, lg, stop: threading.Thread(
        target=run_ws, args=(hub, args.ws, args.sid), daemon=True).start()

    class Ctl(http.server.BaseHTTPRequestHandler):
        def _reply(self, code, body, kind="text/plain"):
            self.send_response(code)
            self.send_header("content-type", kind)
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):  # noqa: N802
            url = urllib.parse.urlparse(self.path)
            query = urllib.parse.parse_qs(url.query)
            if url.path == "/shot":
                with server.hub.cond:
                    jpeg = server.hub.jpeg
                return self._reply(200 if jpeg else 503, jpeg or b"no frame", "image/jpeg")
            if url.path == "/shot.png":
                with server.hub.cond:
                    jpeg = server.hub.jpeg
                if not jpeg:
                    return self._reply(503, b"no frame")
                from PIL import Image  # noqa: PLC0415  (only the PNG route needs Pillow)
                import io  # noqa: PLC0415
                out = io.BytesIO()
                Image.open(io.BytesIO(jpeg)).convert("RGB").save(out, "PNG")
                return self._reply(200, out.getvalue(), "image/png")
            if url.path.startswith("/key/"):
                name = url.path[5:]
                if name != "back" and name not in OH_KEYS:
                    return self._reply(400, b"unknown key")
                return self._reply(200 if commands.key(name) else 503, b"ok")
            if url.path == "/click":
                ok = commands.click(int(query["x"][0]), int(query["y"][0]))
                return self._reply(200 if ok else 503, b"ok")
            if url.path == "/longclick":
                ok = commands.long_click(int(query["x"][0]), int(query["y"][0]))
                return self._reply(200 if ok else 503, b"ok")
            if url.path == "/hold":
                ok = commands.hold(int(query["x"][0]), int(query["y"][0]))
                return self._reply(200 if ok else 503, b"ok")
            if url.path == "/type":
                ok = all(commands.type_char(ch) for ch in query["text"][0])
                return self._reply(200 if ok else 503, b"ok")
            if url.path == "/clear":
                return self._reply(200 if commands.clear_field() else 503, b"ok")
            if url.path == "/reply":
                body, commands.last_reply = commands.last_reply, b""
                return self._reply(200, body)
            if url.path.startswith("/img/"):
                data = IMAGES.get(url.path[5:])
                if data is None:
                    return self._reply(404, b"")
                return self._reply(200, data, "image/png" if data[:1] == b"\x89" else "image/jpeg")
            if url.path == "/state" and query:
                apply_state(query)
                return self._reply(200, b"ok")
            if url.path == "/state":
                return self._reply(200, json.dumps(STATE).encode(), "application/json")
            if url.path.startswith("/keylong/"):
                name = url.path[9:]
                if name not in OH_KEYS:
                    return self._reply(400, b"unknown key")
                return self._reply(200 if commands.key_long(name) else 503, b"ok")
            if url.path == "/setroute":
                ROUTE_BOX["name"] = query.get("name", [""])[0]
                return self._reply(200, b"ok")
            if url.path == "/route":
                name, ROUTE_BOX["name"] = ROUTE_BOX["name"], ""
                return self._reply(200, name.encode())
            if url.path == "/health":
                return self._reply(200, f"frames={server.hub.count} size={server.hub.size} cmd={'up' if commands.conn else 'down'} images={len(IMAGES)} reply={commands.last_reply[-120:]!r}\n".encode())
            return self._reply(404, b"")

        def do_POST(self):  # noqa: N802
            raw = self.rfile.read(int(self.headers.get("content-length", "0")))
            url = urllib.parse.urlparse(self.path)
            if url.path == "/imgput":
                IMAGES[urllib.parse.parse_qs(url.query)["id"][0]] = raw
                return self._reply(200, b"ok")
            body = json.loads(raw or b"{}")
            if url.path == "/preview-state":
                apply_state({
                    "route": [str(body.get("route", ""))],
                    "kind": [str(body.get("kind", ""))],
                    "work": [str(body.get("work_id", ""))],
                    "generation": [str(body.get("generation", "0"))],
                })
                return self._reply(200, b"ok")
            if url.path == "/row-image":
                # Compatibility for older local overlays; capture.py gates on the staged on-complete event below.
                append_row_image_event(body)
                return self._reply(200, b"ok")
            if url.path == "/row-image-stage":
                append_detail_image_stage(body)
                return self._reply(200, b"ok")
            if url.path == "/layout-stage":
                append_detail_layout_stage(body)
                return self._reply(200, b"ok")
            ok = commands.send(body["command"], body.get("args"), body.get("type", "action"))
            return self._reply(200 if ok else 503, b"ok")

        def log_message(self, *a):
            pass

    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", args.ctl), Ctl)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    log(f"control on 127.0.0.1:{args.ctl}")
    server.serve()


if __name__ == "__main__":
    main()
