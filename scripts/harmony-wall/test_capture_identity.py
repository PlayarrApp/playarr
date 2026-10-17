import unittest
import hashlib
import contextlib
import io
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "sim-vnc"))

import harmony_vnc
from capture_identity import (guarded_frame, install_expected_identity_digest, match_profile_identity,
                               authorize_after_identity_setup, parse_identity_digest,
                               verify_signed_in_identity, wait_for_verified_identity)
from patch_state import profiles


class CaptureIdentityTests(unittest.TestCase):
    def test_accepts_matching_current_identity(self):
        verify_signed_in_identity({"auth_verified": True, "auth_current": True})

    def test_refuses_missing_identity(self):
        with self.assertRaisesRegex(ValueError, "did not match"):
            verify_signed_in_identity({})

    def test_refuses_non_current_profile(self):
        with self.assertRaisesRegex(ValueError, "not current"):
            verify_signed_in_identity({"auth_verified": True, "auth_current": False})

    def test_parses_only_a_single_tagged_sha256(self):
        digest = "a" * 64
        self.assertEqual(parse_identity_digest("login 200\nIDENTITY_SHA256=" + digest + "\nauthorize 204\n"), digest)
        with self.assertRaisesRegex(ValueError, "could not be verified"):
            parse_identity_digest("IDENTITY_SHA256=private-name")

    def test_bridge_keeps_only_boolean_identity_result(self):
        profile_id = "private-profile-id"
        digest = hashlib.sha256(profile_id.encode()).hexdigest()
        verified, current = match_profile_identity(profile_id, digest, True)
        self.assertTrue(verified)
        self.assertTrue(current)
        self.assertEqual(match_profile_identity(profile_id, "b" * 64, True), (False, False))
        self.assertEqual(match_profile_identity(profile_id, digest, False), (True, False))

    def test_profile_patch_reports_current_profile_id_only(self):
        patched = profiles("      this.profiles = result.value;\n")
        self.assertIn("encodeURIComponent(currentProfile.id)", patched)
        self.assertIn("auth_current=1", patched)
        self.assertNotIn("currentProfile.username", patched)

    def test_capture_guard_rejects_frames_until_verified(self):
        called = []
        with self.assertRaisesRegex(ValueError, "not been verified"):
            guarded_frame(False, lambda: called.append("frame"))
        self.assertEqual(called, [])
        self.assertEqual(guarded_frame(True, lambda: b"frame"), b"frame")

    def test_expected_digest_is_installed_on_loopback_before_authorisation(self):
        seen = []

        class Response:
            status = 200
            def __enter__(self):
                return self
            def __exit__(self, *_args):
                return False

        def opener(request, timeout):
            seen.append((request.full_url, timeout))
            return Response()

        digest = "a" * 64
        install_expected_identity_digest("http://[::1]:40117/state", digest, opener)
        self.assertEqual(len(seen), 1)
        self.assertIn("clear_identity=1", seen[0][0])
        self.assertIn("expected_digest=" + digest, seen[0][0])
        self.assertEqual(seen[0][1], 10)

    def test_digest_install_rejects_non_loopback_endpoint(self):
        with self.assertRaisesRegex(ValueError, "endpoint is invalid"):
            install_expected_identity_digest("http://example.com/state", "a" * 64, lambda *_a, **_k: None)

    def test_bridge_identity_is_installed_before_device_authorisation(self):
        order = []

        def install(url, digest):
            order.append(("identity", url, digest))

        def authorize(path, body, token):
            order.append(("authorize", path, body["user_code"], token))
            return 204, ""

        result = authorize_after_identity_setup("TEST-CODE", "volatile-token", "a" * 64,
                                                "http://[::1]:40117/state", authorize, install)
        self.assertEqual(result, (204, ""))
        self.assertEqual([event[0] for event in order], ["identity", "authorize"])

    def test_waits_for_the_apps_authenticated_profile_report(self):
        samples = iter(({}, {"auth_verified": True, "auth_current": True}))
        sleeps = []
        state = wait_for_verified_identity(lambda: next(samples), attempts=3, sleep=sleeps.append)
        self.assertTrue(state["auth_current"])
        self.assertEqual(sleeps, [1])

    def test_wait_accepts_an_immediate_authenticated_profile_report(self):
        sleeps = []
        state = wait_for_verified_identity(lambda: {"auth_verified": True, "auth_current": True}, sleep=sleeps.append)
        self.assertTrue(state["auth_verified"])
        self.assertEqual(sleeps, [])

    def test_waits_across_slow_pairing_until_the_profile_is_current(self):
        samples = iter(({}, {}, {}, {"auth_verified": True, "auth_current": True}))
        sleeps = []
        state = wait_for_verified_identity(lambda: next(samples), attempts=5, sleep=sleeps.append)
        self.assertTrue(state["auth_current"])
        self.assertEqual(sleeps, [1, 1, 1])

    def test_wait_refuses_profile_identity_mismatch(self):
        with self.assertRaisesRegex(ValueError, "not current"):
            wait_for_verified_identity(lambda: {"auth_verified": True, "auth_current": False}, sleep=lambda _delay: None)

    def test_capture_does_not_force_profiles_route_before_authentication(self):
        source = (Path(__file__).with_name("capture.py")).read_text(encoding="utf-8")
        pairing_section = source.split("# 2. Pairing owns", 1)[1].split("# Seed only", 1)[0]
        self.assertNotIn('route("profiles"', pairing_section)
        self.assertIn("wait_for_verified_identity(read_identity_state)", pairing_section)
        self.assertLess(source.index('"--identity-control-url"'), source.index("wait_for_verified_identity(read_identity_state)"))

    def test_bridge_apply_state_matches_mismatches_and_resets_without_disclosure(self):
        previous_expected = harmony_vnc.EXPECTED_IDENTITY_SHA256
        previous_state = dict(harmony_vnc.STATE)
        profile_id = "private-profile-id"
        digest = hashlib.sha256(profile_id.encode()).hexdigest()
        try:
            harmony_vnc.apply_state({"clear_identity": ["1"], "expected_digest": [digest]})
            self.assertEqual(harmony_vnc.EXPECTED_IDENTITY_SHA256, digest)
            self.assertNotIn("auth_verified", harmony_vnc.STATE)

            stdout = io.StringIO()
            with contextlib.redirect_stdout(stdout):
                harmony_vnc.apply_state({"auth": [profile_id], "auth_current": ["1"]})
            self.assertEqual(stdout.getvalue(), "")
            self.assertTrue(harmony_vnc.STATE["auth_verified"])
            self.assertTrue(harmony_vnc.STATE["auth_current"])
            self.assertNotIn(profile_id, json.dumps(harmony_vnc.snapshot_state()))

            harmony_vnc.apply_state({"auth": ["different-profile-id"], "auth_current": ["1"]})
            self.assertFalse(harmony_vnc.STATE["auth_verified"])
            self.assertFalse(harmony_vnc.STATE["auth_current"])

            harmony_vnc.apply_state({"auth": [profile_id], "auth_current": ["0"]})
            self.assertTrue(harmony_vnc.STATE["auth_verified"])
            self.assertFalse(harmony_vnc.STATE["auth_current"])

            harmony_vnc.apply_state({"clear_identity": ["1"]})
            self.assertEqual(harmony_vnc.EXPECTED_IDENTITY_SHA256, "")
            self.assertNotIn("auth_verified", harmony_vnc.STATE)
            self.assertNotIn("auth_current", harmony_vnc.STATE)
            self.assertNotIn(profile_id, json.dumps(harmony_vnc.snapshot_state()))
        finally:
            harmony_vnc.STATE.clear()
            harmony_vnc.STATE.update(previous_state)
            harmony_vnc.EXPECTED_IDENTITY_SHA256 = previous_expected


if __name__ == "__main__":
    unittest.main()
