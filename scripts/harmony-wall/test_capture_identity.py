import unittest
import sys
from pathlib import Path
import importlib.util

HERE = Path(__file__).resolve().parent
sys.path.extend((str(HERE), str(HERE.parent / "sim-vnc")))
from capture_identity import verify_identity
from harmony_vnc import update_preview_identity

PATCH_SPEC = importlib.util.spec_from_file_location("harmony_patch_state", HERE / "patch_state.py")
patch_state = importlib.util.module_from_spec(PATCH_SPEC)
PATCH_SPEC.loader.exec_module(patch_state)


class CaptureIdentityTests(unittest.TestCase):
    def test_preview_patch_reports_fresh_current_profile_and_clears_old_marker(self):
        source = (HERE.parents[1] / "clients/harmony/entry/src/main/ets/pages/Profiles.ets").read_text()
        patched = patch_state.profile_identity(source)
        self.assertIn("reportPreviewCurrentAccount('')", patched)
        self.assertIn("profile.is_current === true", patched)
        self.assertIn("currentProfiles.length === 1", patched)
        self.assertIn("reportPreviewCurrentAccount(currentProfiles[0].username)", patched)
        self.assertIn("currentProfiles.length === 1", patched)
        preview_state = (HERE / "overlay/src/main/ets/util/PreviewState.ets").read_text()
        self.assertIn("PREVIEW_ACCOUNT_SEQUENCE += 1", preview_state)
        self.assertIn("sequence: PREVIEW_ACCOUNT_SEQUENCE", preview_state)

    def test_preview_patch_clears_identity_on_signout_and_revoked_session(self):
        source = (HERE.parents[1] / "clients/harmony/entry/src/main/ets/auth/SessionManager.ets").read_text()
        patched = patch_state.invalidate_preview_identity(source)
        self.assertEqual(patched.count("reportPreviewCurrentAccount('');"), 2)
        self.assertIn("public async signOut(): Promise<void> {\n    reportPreviewCurrentAccount('');", patched)
        self.assertIn("private async applyRefreshFailure(): Promise<void> {\n    reportPreviewCurrentAccount('');", patched)

    def test_bridge_rejects_out_of_order_identity_updates(self):
        source = (HERE / "harmony_vnc.py").read_text()
        self.assertIn("update_preview_identity(STATE, username, sequence)", source)
        state = {"preview_identity_sequence": 4, "preview_current_username": "device-test"}
        self.assertTrue(update_preview_identity(state, "", 3))
        self.assertEqual(state["preview_current_username"], "device-test")
        self.assertEqual(state["preview_identity_sequence"], 4)
        self.assertTrue(update_preview_identity(state, "", 5))
        self.assertNotIn("preview_current_username", state)
        self.assertFalse(update_preview_identity(state, "x" * 129, 6))

    def test_requires_exact_current_account_match(self):
        verify_identity("device-test", "device-test")
        for actual, expected in ((None, "device-test"), ("other", "device-test"),
                                 ("device-test", ""), ("device-test", None)):
            with self.subTest(actual=actual, expected=expected), self.assertRaises(ValueError):
                verify_identity(actual, expected)


if __name__ == "__main__":
    unittest.main()
