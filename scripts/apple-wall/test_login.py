#!/usr/bin/env python3
"""Integration checks for the Apple wall's fail-closed profile selection."""
import http.server
import json
import os
import subprocess
import threading
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("login.py")
EXPECTED_USERNAME = "device-test-user"
DEVICE_ID = "test-device"
DEVICE_PROFILE = {
    "id": "device-profile",
    "username": EXPECTED_USERNAME,
    "display_name": "Device Test",
    "is_current": True,
    "pin_locked": False,
}


class State:
    def __init__(self):
        self.current = "device-profile"
        self.initial_user = "device-profile"
        self.device_username = EXPECTED_USERNAME
        self.profiles_requests = 0


class Handler(http.server.BaseHTTPRequestHandler):
    state = None

    def log_message(self, *_args):
        pass

    def reply(self, value):
        body = json.dumps(value).encode()
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        payload = json.loads(self.rfile.read(int(self.headers["content-length"])))
        if self.path == "/api/v1/auth/login":
            user_id = payload.get("profile_user_id", self.state.initial_user)
            if payload.get("profile_user_id"):
                self.state.current = user_id
            self.reply({"user_id": user_id, "access_token": "access", "refresh_token": "refresh"})
            return
        self.send_error(404)

    def do_GET(self):
        if self.path != "/api/v1/users/profiles":
            self.send_error(404)
            return
        self.state.profiles_requests += 1
        target = dict(DEVICE_PROFILE, is_current=self.state.current == "device-profile")
        profiles = [target]
        if self.state.initial_user == "account-owner":
            profiles.append({
                "id": "account-owner", "username": "account-owner",
                "display_name": "Owner", "is_current": self.state.current == "account-owner",
            })
        if self.state.device_username != EXPECTED_USERNAME:
            target["username"] = self.state.device_username
        if self.state.profiles_requests > 1 and self.state.current == "wrong-profile":
            profiles = [dict(target, is_current=False), {
                "id": "wrong-profile", "username": EXPECTED_USERNAME,
                "display_name": "Device Test", "is_current": True,
            }]
        self.reply({"profiles": profiles})


class LoginGuardTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = http.server.HTTPServer(("localhost", 0), Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def run_login(self, state, *args):
        Handler.state = state
        env = dict(os.environ, PLAYARR_TEST_SERVER_URL=f"http://localhost:{self.server.server_port}",
                   TEST_USERNAME=EXPECTED_USERNAME, TEST_PASSWORD="test-password",
                   DEVICE_NAME="test")
        return subprocess.run(["python3", str(SCRIPT), *args], env=env, capture_output=True, text=True)

    def test_device_test_profile_is_verified_again_after_login(self):
        state = State()
        result = self.run_login(state)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), "access refresh")
        self.assertEqual(state.profiles_requests, 2)

    def test_profile_owned_by_another_account_is_rejected_before_switch(self):
        state = State()
        state.device_username = "different-account"
        result = self.run_login(state)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(state.profiles_requests, 1)
        self.assertIn("does not belong", result.stderr)
        self.assertEqual(result.stdout, "")

    def test_switch_to_verified_device_test_profile_succeeds(self):
        state = State()
        state.initial_user = "account-owner"
        state.current = "account-owner"
        result = self.run_login(state)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), "access refresh")
        self.assertEqual(state.profiles_requests, 2)

    def test_verified_user_id_uses_the_same_login_response_as_the_tokens(self):
        state = State()
        result = self.run_login(state, "--include-user-id")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), "access refresh device-profile")
        self.assertEqual(state.profiles_requests, 2)

    def test_post_switch_current_profile_must_match_selected_test_profile(self):
        state = State()
        state.initial_user = "account-owner"
        state.current = "account-owner"
        original_post = Handler.do_POST

        def post_as_wrong_profile(handler):
            payload = json.loads(handler.rfile.read(int(handler.headers["content-length"])))
            if payload.get("profile_user_id"):
                state.current = "wrong-profile"
                handler.reply({"user_id": "device-profile", "access_token": "access", "refresh_token": "refresh"})
            else:
                state.current = "account-owner"
                handler.reply({"user_id": "account-owner", "access_token": "access", "refresh_token": "refresh"})

        Handler.do_POST = post_as_wrong_profile
        try:
            result = self.run_login(state)
        finally:
            Handler.do_POST = original_post
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("verification failed", result.stderr)
        self.assertEqual(result.stdout, "")


if __name__ == "__main__":
    unittest.main()
