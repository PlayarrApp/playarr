#!/usr/bin/env python3
"""Tiny Playarr API stand-in for offscreen smoke runs: python3 fake_server.py <port>.
Serves placeholder data only (neutral titles, generated solid-colour artwork)."""
import json, struct, sys, zlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def png(rgb, w=64, h=36):
    row = b"\x00" + bytes(rgb) * w
    raw = zlib.compress(row * h)

    def chunk(t, d):
        c = struct.pack(">I", len(d)) + t + d
        return c + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)

    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", raw) + chunk(b"IEND", b"")


def work(i, kind, title, art=True):
    return {"id": f"w{i}", "kind": kind, "external_refs": [], "title": title, "sort_title": title, "overview": "Placeholder overview.",
            "images": [{"kind": "backdrop", "url": "x", "width": None, "height": None}] if art else [], "genres": ["Adventure"], "tags": [],
            "added_at": "2026-01-01T00:00:00Z", "release_date": "2020-06-01", "monitored": True, "availability": "available"}


MOVIES = [work(i, "movie", f"Test Movie {c}", art=i % 2 == 0) for i, c in enumerate("ABCDEF")]
SERIES = [work(10 + i, "series", f"Sample Series {i + 1}") for i in range(3)]
DL = bytes(range(256)) * 12000  # about 3 MB of placeholder bytes
ALL = {w["id"]: w for w in MOVIES + SERIES}


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def send(self, code, body, ctype="application/json"):
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        self.send(204, b"")

    do_PUT = do_POST

    def do_GET(self):
        p = self.path.split("?")[0]
        if p == "/api/v1/home/rails":
            return self.send(200, {"rails": [{"id": "m", "kind": "recent", "library": "movie", "title": "Recently Added in Movies", "items": MOVIES},
                                              {"id": "s", "kind": "recent", "library": "series", "title": "Recently Added in Series", "items": SERIES}]})
        if p == "/api/v1/playback/progress":
            return self.send(200, [])
        if p.startswith("/api/v1/playback/") and p.count("/") == 4:
            return self.send(200, {"mode": "direct", "url": "/api/v1/media/f0/stream", "mime_type": "video/mp4", "duration_ms": 3600000, "source_offset_ms": 0,
                                   "audio_tracks": [{"id": "a1", "stream_index": 1, "label": "English 5.1", "is_default": True}, {"id": "a2", "stream_index": 2, "label": "Commentary", "is_default": False}],
                                   "selected_audio_track_id": "a1",
                                   "subtitle_tracks": [{"id": "s1", "stream_index": 3, "label": "English", "language": "eng", "codec": "webvtt", "is_default": True, "forced": False, "url": "/api/v1/media/f0/subtitles/3"}],
                                   "selected_subtitle_track_id": None,
                                   "quality_options": [{"id": "orig", "label": "Original", "profile": None, "height": None, "video_bitrate_bps": None},
                                                       {"id": "q1", "label": "720p 4 Mbps", "profile": "h264-720p-4mbps", "height": 720, "video_bitrate_bps": 4000000}],
                                   "selected_quality_id": "orig", "session_id": "00000000-0000-0000-0000-000000000001"})
        if p == "/api/v1/downloads":
            return self.send(200, [{"id": "6a5e2c3e-2b9a-4b3e-9b7a-8e2f1c3d4a5b", "media_file_id": "f0", "quality_id": "original", "status": "ready",
                                    "container": "mkv", "requested_at": "2026-01-01T00:00:00Z", "size_bytes": len(DL)}])
        if p.endswith("/file") and p.startswith("/api/v1/downloads/"):
            rng = self.headers.get("Range")
            start = int(rng.split("=")[1].split("-")[0]) if rng else 0
            body = DL[start:]
            self.send_response(206 if rng else 200)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Content-Type", "video/x-matroska")
            self.end_headers()
            self.wfile.write(body)
            return
        if "/subtitles/" in p:
            return self.send(200, b"WEBVTT\n\n00:00:00.000 --> 00:10:00.000\nPlaceholder subtitle line\n", "text/vtt")
        if p == "/api/v1/catalog":
            items = MOVIES if "kind=movie" in self.path else SERIES
            return self.send(200, {"items": items, "total": len(items), "available_on": {}, "remote_only": []})
        if p.startswith("/api/v1/catalog/"):
            w = ALL.get(p.rsplit("/", 1)[1])
            if not w:
                return self.send(404, {})
            eps = [{"episode": {"id": "e1", "season_id": "s1", "episode_number": 1, "title": "Pilot", "images": [], "monitored": True, "availability": "available"},
                    "media_file_id": "f1", "runtime_ms": 1500000}]
            ch = {"Series": [{"season": {"id": "s1", "series_work_id": w["id"], "season_number": 1, "monitored": True, "availability": "available"}, "episodes": eps}]} if w["kind"] == "series" else "Movie"
            return self.send(200, {"work": w, "children": ch, "media_file_id": "f0" if w["kind"] == "movie" else None, "runtime_ms": 3600000, "available_on": []})
        if p == "/api/v1/users/profiles":
            return self.send(200, [{"id": "u1", "username": "device-test", "display_name": "Device Test", "is_current": True, "pin_locked": False}])
        if p == "/api/v1/users/me/profile-avatar":
            return self.send(200, {"preference": {"kind": "preset", "value": "alien"}})
        if p.startswith("/api/v1/artwork/") or p.endswith("/thumbnail"):
            return self.send(200, png((70, 90, 160)), "image/png")
        return self.send(404, {})


ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1])), H).serve_forever()
