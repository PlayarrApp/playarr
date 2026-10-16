import contextlib
import importlib.util
import io
import os
from pathlib import Path
import unittest
import uuid
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

    def test_default_identity_retains_stable_wall_fallback(self):
        with patch.dict(os.environ, {"DEVICE_NAME": "", "APPLE_WALL_DEVICE_NAME": ""}):
            identity = login_module.device_identity()
        expected = "5a1e0000-0000-4000-8000-%012x" % (
            uuid.uuid5(uuid.NAMESPACE_DNS, "apple-wall.wall").int & 0xFFFFFFFFFFFF
        )
        self.assertEqual(identity["device_id"], expected)
        self.assertEqual(identity["device_name"], "apple-wall")

    def test_explicit_job_names_isolate_device_ids(self):
        names = ["wall-run-attempt-macos-dark", "wall-run-attempt-macos-light"]
        identities = []
        for name in names:
            with patch.dict(os.environ, {"APPLE_WALL_DEVICE_NAME": name, "DEVICE_NAME": "wall-macos"}):
                identities.append(login_module.device_identity())
        self.assertNotEqual(identities[0]["device_id"], identities[1]["device_id"])
        self.assertEqual([identity["device_name"] for identity in identities], names)

    def test_login_and_device_id_bootstrap_share_explicit_identity(self):
        name = "wall-run-attempt-tvos-light"
        with patch.dict(os.environ, {"APPLE_WALL_DEVICE_NAME": name, "DEVICE_NAME": "wall-tvos"}):
            expected = login_module.device_identity()
            call, _ = self.run_login([
                {"user_id": "device-profile-id", "access_token": "access", "refresh_token": "refresh"},
                [self.profile],
                [{**self.profile, "is_current": True}],
            ])
            self.assertEqual(call.call_args_list[0].args[1]["device_id"], expected["device_id"])
            self.assertEqual(call.call_args_list[0].args[1]["device_name"], expected["device_name"])
            self.assertEqual(login_module.device_identity()["device_id"], expected["device_id"])


if __name__ == "__main__":
    unittest.main()
