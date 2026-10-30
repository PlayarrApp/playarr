import base64
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

HOME = tempfile.mkdtemp()
(Path(HOME) / ".secrets").write_text("PLAYARR_VIDAA_MIRROR_TOKEN=tok\nPLAYARR_DEVICE_TEST_USERNAME=live\nPLAYARR_DEVICE_TEST_SERVER_URL=https://live.example\nPLAYARR_PARITY_STATIC_PASSWORD=pw\n")
os.environ.update(HOME=HOME, MIRROR_DIST=HOME, MIRROR_RECOVERY_DATA=HOME)
sys.path.insert(0, os.path.dirname(__file__))
import receiver


class LoadSecrets(unittest.TestCase):
    def test_live_account_without_parity_env(self):
        s = receiver.load_secrets({})
        self.assertEqual((s["PLAYARR_DEVICE_TEST_USERNAME"], s["PLAYARR_DEVICE_TEST_SERVER_URL"]), ("live", "https://live.example"))

    def test_static_account_with_parity_env(self):
        s = receiver.load_secrets({"PARITY_SERVER_URL": "http://static.example:1/", "PARITY_ACCOUNT_NAME": "parity"})
        self.assertEqual((s["PLAYARR_DEVICE_TEST_USERNAME"], s["PLAYARR_DEVICE_TEST_SERVER_URL"]), ("parity", "http://static.example:1"))

    def test_seed_page_logs_in_server_side_and_hides_the_password(self):
        sub = base64.urlsafe_b64encode(json.dumps({"sub": "u1"}).encode()).decode().rstrip("=")
        reply = mock.Mock()
        reply.read.return_value = json.dumps({"access_token": f"h.{sub}.s", "refresh_token": "r", "expires_in": 900}).encode()
        sent = []
        def urlopen(req, timeout):
            sent.append(req)
            return reply
        secrets = receiver.load_secrets({"PARITY_SERVER_URL": "http://static.example:1", "PARITY_ACCOUNT_NAME": "parity"})
        with mock.patch("urllib.request.urlopen", urlopen):
            html = receiver.seed_page(secrets).decode()
        self.assertEqual(sent[0].full_url, "http://static.example:1/api/v1/auth/login")
        self.assertIn('"userId": "u1"', html)
        self.assertNotIn('"pw"', html)
        self.assertIn("playarr.profileSessions.v4", html)


class JobAndCommandChannels(unittest.TestCase):
    """The layout job, the one-shot Back command and the frame lookup by request id, over a real local server."""

    @classmethod
    def setUpClass(cls):
        import threading, http.server
        cls.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), receiver.H)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.base = "http://127.0.0.1:%d" % cls.server.server_address[1]

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    def call(self, method, path, body=None, token="tok"):
        import urllib.request, urllib.error
        req = urllib.request.Request(self.base + path + ("&" if "?" in path else "?") + "t=" + token, json.dumps(body).encode() if body is not None else None, method=method)
        try:
            with urllib.request.urlopen(req, timeout=5) as r:
                return r.status, r.read()
        except urllib.error.HTTPError as e:
            return e.code, e.read()

    def test_job_needs_the_token_and_a_plain_id(self):
        self.assertEqual(self.call("POST", "/__mirror/job", {"id": "a-1", "expr": "1"}, token="bad")[0], 403)
        self.assertEqual(self.call("POST", "/__mirror/job", {"id": "../x", "expr": "1"})[0], 400)
        self.assertEqual(self.call("POST", "/__mirror/job", {"id": "a-1", "expr": "(1+1)"})[0], 204)
        self.assertEqual(json.loads(self.call("GET", "/__mirror/job")[1]), {"id": "a-1", "expr": "(1+1)"})

    def test_back_command_is_handed_over_once_and_only_for_back(self):
        self.assertEqual(self.call("POST", "/__mirror/cmd", {"id": "c1", "key": "power"})[0], 400)
        self.assertEqual(self.call("POST", "/__mirror/cmd", {"id": "c1", "key": "back"})[0], 204)
        self.assertEqual(json.loads(self.call("GET", "/__mirror/cmd")[1]), {"id": "c1", "key": "back"})
        self.assertEqual(json.loads(self.call("GET", "/__mirror/cmd")[1]), {})

    def test_frame_is_found_by_its_request_id(self):
        (receiver.FRAMES / "frame-0000000000001.json").write_text(json.dumps({"requestId": "r1", "hasImage": True}))
        (receiver.FRAMES / "frame-0000000000001.jpg").write_bytes(b"\x89PNGrest")
        (receiver.FRAMES / "frame-0000000000002.json").write_text(json.dumps({"requestId": "r2", "hasImage": False}))
        self.assertEqual(json.loads(self.call("GET", "/__mirror/frame.json?id=r1")[1])["requestId"], "r1")
        self.assertEqual(self.call("GET", "/__mirror/frame.png?id=r1")[1], b"\x89PNGrest")
        self.assertEqual(self.call("GET", "/__mirror/frame.json?id=nope")[0], 404)


if __name__ == "__main__":
    unittest.main()
