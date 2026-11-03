import base64
import json
import os
import sys
import tempfile
import time
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


class UnchangedFrames(unittest.TestCase):
    """A frame that says imageUnchanged stores the receiver's last picture again; with none stored the page is told to upload one."""

    def post(self, body):
        import threading
        import urllib.request
        from http.server import ThreadingHTTPServer
        server = ThreadingHTTPServer(("127.0.0.1", 0), receiver.H)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            req = urllib.request.Request("http://127.0.0.1:%d/__mirror/frame" % server.server_port, json.dumps(body).encode(), {"Content-Type": "application/json"})
            with urllib.request.urlopen(req) as r:
                reply = json.loads(r.read())
        finally:
            server.shutdown()
            server.server_close()
        newest = sorted(receiver.FRAMES.glob("frame-*.json"))[-1]
        return reply, json.loads(newest.read_text()), newest.with_suffix(".jpg")

    def test_unchanged_frame_reuses_the_last_picture(self):
        png = base64.b64encode(b"\x89PNG-test").decode()
        with mock.patch.object(receiver.H, "_authed", lambda self: True), mock.patch.object(receiver, "identity_rejection", lambda *a, **k: "accepted"), mock.patch.object(receiver, "identity_allowed", lambda *a, **k: True):
            receiver.LAST_IMAGE = None
            reply, meta, _ = self.post({"identity": {}, "imageUnchanged": True})
            self.assertEqual((reply.get("needImage"), meta["hasImage"]), (True, False))
            time.sleep(0.01)
            reply, meta, _ = self.post({"identity": {}, "image": "data:image/png;base64," + png})
            self.assertEqual((reply.get("needImage"), meta["hasImage"]), (None, True))
            time.sleep(0.01)
            reply, meta, jpg = self.post({"identity": {}, "imageUnchanged": True})
            self.assertEqual((reply.get("needImage"), meta["hasImage"]), (None, True))
            self.assertEqual(jpg.read_bytes(), b"\x89PNG-test")


class SignedOutIdentity(unittest.TestCase):
    """A page with no sign-in at all is a signed-out page, not another account: only the exact empty shape is accepted."""
    NOW = 1_000_000
    SECRETS = {"PLAYARR_DEVICE_TEST_USERNAME": "live", "PLAYARR_DEVICE_TEST_SERVER_URL": "https://live.example"}

    def identity(self, **over):
        base = {"status": "signed_out", "username": None, "serverUrl": None, "isCurrentCount": 0, "sessionChanged": False, "checkedAt": self.NOW - 100}
        base.update(over)
        return base

    def test_signed_out_shape_is_accepted(self):
        self.assertEqual(receiver.identity_rejection(self.identity(), self.SECRETS, self.NOW), "accepted")
        self.assertTrue(receiver.identity_allowed(self.identity(), self.SECRETS, self.NOW))

    def test_foreign_or_malformed_signed_out_is_refused(self):
        for over in ({"username": "someone-else"}, {"username": "live"}, {"serverUrl": "https://live.example"}, {"isCurrentCount": 1},
                     {"sessionChanged": True}, {"checkedAt": self.NOW - 6000}, {"checkedAt": self.NOW + 5}, {"checkedAt": None}):
            with self.subTest(over=over):
                self.assertEqual(receiver.identity_rejection(self.identity(**over), self.SECRETS, self.NOW), "signed_out_shape_invalid")
                self.assertFalse(receiver.identity_allowed(self.identity(**over), self.SECRETS, self.NOW))

    def test_another_account_is_still_refused(self):
        other = {"status": "ok", "username": "someone-else", "serverUrl": "https://live.example", "isCurrentCount": 1, "sessionChanged": False, "checkedAt": self.NOW - 100}
        self.assertEqual(receiver.identity_rejection(other, self.SECRETS, self.NOW), "username_not_allowlisted")
        self.assertFalse(receiver.identity_allowed(other, self.SECRETS, self.NOW))
        self.assertEqual(receiver.identity_rejection(self.identity(status="identity_unavailable"), self.SECRETS, self.NOW), "identity_unavailable")

    def test_signed_out_page_clears_storage_and_forwards_the_launch_flags(self):
        from urllib.parse import parse_qs
        html = receiver.signed_out_page(self.SECRETS, parse_qs("next=%2Flogin%3FmirrorPng%3D1&mirrorToken=tok&platform=tv-vidaa")).decode()
        self.assertIn("localStorage.clear()", html)
        self.assertIn('"/login?mirrorPng=1&mirrorToken=tok&platform=tv-vidaa"', html)
        self.assertNotIn("accessToken", html)
        self.assertIsNone(receiver.signed_out_page(self.SECRETS, parse_qs("next=%2F%2Fevil.example")))


class PageJobs(unittest.TestCase):
    def test_job_is_stored_and_only_valid_ids_are_accepted(self):
        import threading
        import urllib.error
        import urllib.request
        from http.server import ThreadingHTTPServer
        server = ThreadingHTTPServer(("127.0.0.1", 0), receiver.H)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        base = "http://127.0.0.1:%d/__mirror/job?t=tok" % server.server_port
        try:
            def send(body):
                return urllib.request.urlopen(urllib.request.Request(base, json.dumps(body).encode(), {"Content-Type": "application/json"}))
            self.assertEqual(send({"id": "a-1", "expr": "1+1"}).status, 204)
            with self.assertRaises(urllib.error.HTTPError) as bad:
                send({"id": "../x", "expr": "1"})
            self.assertEqual(bad.exception.code, 400)
            self.assertEqual(json.loads(urllib.request.urlopen(base).read()), {"id": "a-1", "expr": "1+1"})
        finally:
            server.shutdown()
            server.server_close()


if __name__ == "__main__":
    unittest.main()
