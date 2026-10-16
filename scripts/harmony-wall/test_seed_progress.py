import json
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import seed_progress


class SeedProgressTests(unittest.TestCase):
    def run_seed(self, responses):
        calls = []

        def request(method, url, body=None, token=None):
            calls.append((method, url, body, token))
            status, payload = responses.pop(0)
            return status, json.dumps(payload) if not isinstance(payload, str) else payload

        result = seed_progress.seed_progress("https://service.example", "device-test", "credential", request)
        return result, calls

    def test_verifies_account_and_requires_every_progress_write(self):
        result, calls = self.run_seed([
            (200, {"access_token": "test-token"}),
            (200, [{"username": "device-test", "is_current": True}]),
            (200, [{"media_file_id": "sample-file", "position_ms": 100, "duration_ms": 1000, "state": "part_watched"},
                   {"media_file_id": seed_progress.KEEP, "position_ms": 10, "duration_ms": 1000, "state": "part_watched"}]),
            (204, ""),
            (204, ""),
        ])
        self.assertEqual(result, 2)
        self.assertEqual([call[0] for call in calls], ["POST", "GET", "GET", "PUT", "PUT"])
        self.assertEqual(calls[1][1], "https://service.example/api/v1/users/profiles")
        self.assertEqual(calls[3][2]["position_ms"], 0)
        self.assertEqual(calls[4][2]["position_ms"], seed_progress.KEEP_POSITION_MS)

    def test_refuses_to_mutate_when_current_account_does_not_match(self):
        calls = []

        def request(method, url, body=None, token=None):
            calls.append(method)
            if method == "POST":
                return 200, json.dumps({"access_token": "test-token"})
            return 200, json.dumps([{"username": "other-account", "is_current": True}])

        with self.assertRaisesRegex(ValueError, "does not match"):
            seed_progress.seed_progress("https://service.example", "device-test", "credential", request)
        self.assertEqual(calls, ["POST", "GET"])

    def test_fails_when_any_progress_write_fails(self):
        responses = [
            (200, {"access_token": "test-token"}),
            (200, [{"username": "device-test", "is_current": True}]),
            (200, [{"media_file_id": "sample-file", "position_ms": 100, "duration_ms": 1000, "state": "part_watched"}]),
            (503, ""),
        ]
        with self.assertRaisesRegex(ValueError, "reset failed"):
            self.run_seed(responses)

    def test_rejects_malformed_progress_without_writing(self):
        responses = [(200, {"access_token": "test-token"}),
                     (200, [{"username": "device-test", "is_current": True}]),
                     (200, {"items": "not-a-list"})]
        with self.assertRaisesRegex(ValueError, "malformed rows"):
            self.run_seed(responses)


if __name__ == "__main__":
    unittest.main()
