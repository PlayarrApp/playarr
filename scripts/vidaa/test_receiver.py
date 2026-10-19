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


if __name__ == "__main__":
    unittest.main()
