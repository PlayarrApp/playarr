import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import fixture_preflight


class FixturePreflightTests(unittest.TestCase):
    def test_pinned_fixture_configuration_loads_from_repository(self):
        details, seed_id = fixture_preflight._fixtures()
        self.assertEqual([label for label, _ in details], ["film-detail", "series-detail"])
        self.assertTrue(seed_id)

    def test_verifies_device_profile_before_checking_pinned_fixtures(self):
        calls = []

        def requester(server, path, **kwargs):
            calls.append((path, kwargs.get("method", "GET")))
            if path.endswith("/auth/login"):
                return 200, {"access_token": "test-token"}
            if path.endswith("/users/profiles"):
                return 200, [{"username": "device-test", "is_current": True}]
            if path.startswith("/api/v1/catalog/"):
                return 200, {"work": {"id": path.rsplit("/", 1)[-1]}}
            if path.endswith("/progress"):
                return 200, {"position_ms": 0}
            raise AssertionError(path)

        result = fixture_preflight.check_fixtures(
            "https://service.example", "device-test", "credential", requester=requester)
        self.assertTrue(result["ready"])
        self.assertEqual(result["identity"], "verified")
        self.assertEqual(result["fixtures"]["film-detail"], 200)
        self.assertEqual(result["fixtures"]["series-detail"], 200)
        self.assertEqual(result["fixtures"]["seed-progress"], 200)
        self.assertEqual(calls[0][0], "/api/v1/auth/login")
        self.assertEqual(calls[1][0], "/api/v1/users/profiles")
        self.assertEqual(len(calls), 5)

    def test_profile_mismatch_fails_before_any_fixture_request(self):
        calls = []

        def requester(_server, path, **kwargs):
            calls.append(path)
            if path.endswith("/auth/login"):
                return 200, {"access_token": "test-token"}
            return 200, [{"username": "another-account", "is_current": True}]

        result = fixture_preflight.check_fixtures(
            "https://service.example", "device-test", "credential", requester=requester)
        self.assertFalse(result["ready"])
        self.assertEqual(result["failure"], "device-test-profile-mismatch")
        self.assertEqual(calls, ["/api/v1/auth/login", "/api/v1/users/profiles"])

    def test_malformed_profile_response_fails_closed(self):
        def requester(_server, path, **kwargs):
            if path.endswith("/auth/login"):
                return 200, {"access_token": "test-token"}
            return 200, {"profiles": None}

        result = fixture_preflight.check_fixtures(
            "https://service.example", "device-test", "credential", requester=requester)
        self.assertFalse(result["ready"])
        self.assertEqual(result["failure"], "device-test-profile-mismatch")

    def test_missing_seed_fixture_fails_closed(self):
        def requester(_server, path, **kwargs):
            if path.endswith("/auth/login"):
                return 200, {"access_token": "test-token"}
            if path.endswith("/users/profiles"):
                return 200, [{"username": "device-test", "is_current": True}]
            if path.endswith("/progress"):
                return 404, None
            return 200, {"work": {"id": path.rsplit("/", 1)[-1]}}

        result = fixture_preflight.check_fixtures(
            "https://service.example", "device-test", "credential", requester=requester)
        self.assertFalse(result["ready"])
        self.assertEqual(result["failure"], "pinned-fixture-unavailable")
        self.assertEqual(result["fixtures"]["seed-progress"], 404)

    def test_invalid_server_url_makes_no_request(self):
        calls = []
        result = fixture_preflight.check_fixtures(
            "https://user:pass@service.example", "device-test", "credential",
            requester=lambda *_args, **_kwargs: calls.append(1))
        self.assertFalse(result["ready"])
        self.assertEqual(result["failure"], "invalid-server-url")
        self.assertEqual(calls, [])


if __name__ == "__main__":
    unittest.main()
