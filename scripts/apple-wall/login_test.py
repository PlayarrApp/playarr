import contextlib
import importlib.util
import io
import os
from pathlib import Path
import unittest
from unittest.mock import patch


MODULE_PATH = Path(__file__).with_name("login.py")
SPEC = importlib.util.spec_from_file_location("apple_wall_login", MODULE_PATH)
login_module = importlib.util.module_from_spec(SPEC)
with patch.dict(os.environ, {
    "SERVER_URL": "https://example.invalid",
    "TEST_USERNAME": "fixture-user",
    "TEST_PASSWORD": "fixture-password",
}):
    SPEC.loader.exec_module(login_module)


class LoginIdentityGuardTests(unittest.TestCase):
    profile = {"id": "device-profile-id", "display_name": "Device Test", "is_current": True}
    login = {"user_id": "other-profile-id", "access_token": "access-value", "refresh_token": "refresh-value"}

    def run_login(self, responses):
        output = io.StringIO()
        with patch.object(login_module, "call", side_effect=responses) as call, \
                patch.dict(os.environ, {"TEST_USERNAME": "fixture-user", "TEST_PASSWORD": "fixture-password"}), \
                contextlib.redirect_stdout(output):
            login_module.main()
        return call, output.getvalue()

    def test_switches_then_verifies_selected_profile_before_returning_tokens(self):
        call, output = self.run_login([
            self.login,
            [self.profile],
            {"user_id": "device-profile-id", "access_token": "checked-access", "refresh_token": "checked-refresh"},
            [{**self.profile, "is_current": True}],
        ])
        self.assertEqual(call.call_count, 4)
        self.assertEqual(call.call_args_list[2].args[0], "/api/v1/auth/login")
        self.assertEqual(call.call_args_list[3].args[0], "/api/v1/users/profiles")
        self.assertEqual(output, "checked-access checked-refresh\n")

    def test_aborts_if_selected_profile_is_not_current(self):
        with self.assertRaisesRegex(SystemExit, "identity verification failed"):
            self.run_login([self.login, [self.profile], self.login, [{**self.profile, "is_current": False}]])

    def test_aborts_if_selected_profile_name_changes_before_verification(self):
        with self.assertRaisesRegex(SystemExit, "identity verification failed"):
            self.run_login([self.login, [self.profile], self.login, [{**self.profile, "display_name": "Other Profile"}]])

    def test_aborts_if_selected_identity_is_missing(self):
        with self.assertRaisesRegex(SystemExit, "identity verification failed"):
            self.run_login([self.login, [self.profile], self.login, []])

    def test_aborts_if_server_reports_multiple_current_profiles(self):
        other = {"id": "other-id", "display_name": "Other Profile", "is_current": True}
        with self.assertRaisesRegex(SystemExit, "identity verification failed"):
            self.run_login([self.login, [self.profile], self.login, [self.profile, other]])

    def test_aborts_if_profile_identity_is_missing_before_switch(self):
        with self.assertRaisesRegex(SystemExit, "not found"):
            self.run_login([self.login, [{"display_name": "Device Test"}]])


if __name__ == "__main__":
    unittest.main()
