#!/usr/bin/python3
"""Tiny log sink for a debug Tizen build: the emulator reaches the host at 10.0.2.2 (QEMU user networking)."""
import http.server, sys, datetime
OUT = sys.argv[1]
class H(http.server.BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(204); self.send_header("Access-Control-Allow-Origin", "*"); self.send_header("Access-Control-Allow-Headers", "*"); self.end_headers()
    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("content-length", 0))).decode("utf-8", "replace")
        with open(OUT, "a") as f: f.write(f"{datetime.datetime.now().isoformat()} {body}\n")
        self.send_response(204); self.send_header("Access-Control-Allow-Origin", "*"); self.end_headers()
    def do_GET(self):
        # Debug-only command channel: the capture tool writes one command (a hash route) to cmd.txt.
        import os
        cmd_path = os.path.join(os.path.dirname(OUT), "cmd.txt")
        body = b""
        if os.path.exists(cmd_path):
            body = open(cmd_path, "rb").read(); os.remove(cmd_path)
        self.send_response(200); self.send_header("Access-Control-Allow-Origin", "*"); self.send_header("Content-Type", "text/plain"); self.end_headers(); self.wfile.write(body)
    def log_message(self, *a): pass
http.server.HTTPServer(("127.0.0.1", 18733), H).serve_forever()
