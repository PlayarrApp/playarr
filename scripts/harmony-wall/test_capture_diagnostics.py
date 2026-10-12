import json
import unittest
from unittest.mock import mock_open, patch

from capture_diagnostics import save_rejected_frame, summarize_detail_events, write_detail_summary


class FakeFrame:
    def save(self, path):
        self.path = path


class CaptureDiagnosticsTests(unittest.TestCase):
    def test_summary_aggregates_scoped_stages_without_identifiers(self):
        events = [
            {"sequence": 2, "category": "detail-row-image-source", "route": "Detail", "work_id": "private-work",
             "parent_work_id": "private-work", "row_id": "private-row", "generation": 4, "timestamp": 10.2,
             "title": "Private title", "token": "private-token", "url": "https://private.example/path"},
            {"sequence": 3, "category": "detail-row-image-fetch-error", "route": "Detail", "work_id": "private-work",
             "parent_work_id": "private-work", "row_id": "private-row", "generation": 4, "timestamp": 11.5},
            {"sequence": 4, "category": "detail-row-image-on-error", "route": "Detail", "work_id": "private-work",
             "parent_work_id": "private-work", "row_id": "private-row", "generation": 4, "timestamp": 12.0},
            {"sequence": 5, "category": "detail-row-image-on-complete", "route": "Detail", "work_id": "other-work",
             "parent_work_id": "other-work", "row_id": "other-row", "generation": 4, "timestamp": 12.1},
            {"sequence": 6, "category": "detail-row-image-private-title", "route": "Detail", "work_id": "private-work",
             "parent_work_id": "private-work", "row_id": "private-row", "generation": 4, "timestamp": 12.2},
        ]
        result = summarize_detail_events(events, sequence_after=1, work_id="private-work", generation=4, started_at=10.0)
        self.assertEqual(result["source"], {"count": 1, "first_elapsed_ms": 200, "last_elapsed_ms": 200})
        self.assertEqual(result["fetch-error"], {"count": 1, "first_elapsed_ms": 1500, "last_elapsed_ms": 1500})
        self.assertNotIn("on-complete", result)
        self.assertNotIn("private-work", json.dumps(result))
        self.assertNotIn("private-title", json.dumps(result))
        self.assertNotIn("Private title", json.dumps(result))
        self.assertNotIn("private-token", json.dumps(result))
        self.assertNotIn("https://", json.dumps(result))

    @patch("builtins.open", new_callable=mock_open)
    @patch("capture_diagnostics.os.makedirs")
    def test_rejected_frame_and_false_acceptance_are_saved_in_private_debug_output(self, makedirs, open_file):
        out_dir = "private-capture"
        frame = FakeFrame()
        frame_path = save_rejected_frame(frame, out_dir)
        summary = write_detail_summary(out_dir, accepted=False, failure="row-artwork-timeout",
                                       frame_path=frame_path, stages={"source": {"count": 1}})
        self.assertFalse(summary["accepted"])
        self.assertEqual(frame.path, "private-capture/_debug/rejected-series-detail.png")
        self.assertEqual(open_file.call_args.args[0], "private-capture/_debug/series-detail-diagnostics.json")
        saved = json.loads("".join(call.args[0] for call in open_file().write.call_args_list))
        self.assertFalse(saved["accepted"])
        self.assertEqual(saved["frame"], "_debug/rejected-series-detail.png")
        self.assertNotIn("https://", json.dumps(saved))


if __name__ == "__main__":
    unittest.main()
