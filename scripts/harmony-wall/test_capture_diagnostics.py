import json
import unittest
from unittest.mock import mock_open, patch

from capture_diagnostics import (save_rejected_frame, summarize_detail_events,
                                 summarize_detail_layout_events, write_detail_summary)


class FakeFrame:
    def save(self, path):
        self.path = path


class CaptureDiagnosticsTests(unittest.TestCase):
    def test_layout_summary_is_scoped_numeric_and_redacted(self):
        events = [
            {"sequence": 2, "category": "detail-layout-detail-rails-count", "route": "Detail",
             "work_id": "private-work", "generation": 8, "timestamp": 10.1, "value": 3,
             "title": "Private title", "token": "private-token", "url": "https://private.example"},
            {"sequence": 3, "category": "detail-layout-rail-items-count", "route": "Detail",
             "work_id": "private-work", "generation": 8, "timestamp": 10.2, "value": 6},
            {"sequence": 4, "category": "detail-layout-rail-item-appear", "route": "Detail",
             "work_id": "private-work", "generation": 8, "timestamp": 10.3, "value": 1},
            {"sequence": 5, "category": "detail-layout-poster-card-root-area", "route": "Detail",
             "work_id": "private-work", "generation": 8, "timestamp": 10.4,
             "width": 230, "height": 190, "area": 43700},
            {"sequence": 6, "category": "detail-layout-rail-list-height-default-fill", "route": "Detail",
             "work_id": "private-work", "generation": 8, "timestamp": 10.5, "value": 0},
            {"sequence": 7, "category": "detail-layout-poster-card-art-area", "route": "Detail",
             "work_id": "private-work", "generation": 8, "timestamp": 10.6,
             "width": float("nan"), "height": float("inf"), "area": float("inf")},
            {"sequence": 8, "category": "detail-layout-rail-list-area", "route": "Detail",
             "work_id": "other-work", "generation": 8, "timestamp": 10.6,
             "width": 1280, "height": 420, "area": 537600},
            {"sequence": 9, "category": "detail-layout-private-title", "route": "Detail",
             "work_id": "private-work", "generation": 8, "timestamp": 10.7, "title": "Private title"},
        ]
        result = summarize_detail_layout_events(events, sequence_after=1, work_id="private-work",
                                                generation=8, started_at=10.0)
        self.assertEqual(result["detail-rails-count"], {
            "count": 1, "first_elapsed_ms": 100, "last_elapsed_ms": 100,
            "value": {"min": 3, "max": 3},
        })
        self.assertEqual(result["rail-items-count"]["value"], {"min": 6, "max": 6})
        self.assertEqual(result["rail-item-appear"]["count"], 1)
        self.assertEqual(result["poster-card-root-area"]["width"], {"min": 230, "max": 230})
        self.assertEqual(result["rail-list-height-default-fill"]["value"], {"min": 0, "max": 0})
        self.assertEqual(result["poster-card-art-area"]["count"], 1)
        self.assertNotIn("width", result["poster-card-art-area"])
        self.assertNotIn("height", result["poster-card-art-area"])
        self.assertNotIn("area", result["poster-card-art-area"])
        self.assertNotIn("rail-list-area", result)
        self.assertNotIn("private-work", json.dumps(result))
        self.assertNotIn("Private title", json.dumps(result))
        self.assertNotIn("private-token", json.dumps(result))
        self.assertNotIn("https://", json.dumps(result))

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
            {"sequence": 7, "category": "detail-row-image-image-source", "route": "Detail", "work_id": "private-work",
             "parent_work_id": "private-work", "row_id": "private-row", "generation": 4, "timestamp": 10.3},
            {"sequence": 8, "category": "detail-row-image-image-area-positive", "route": "Detail", "work_id": "private-work",
             "parent_work_id": "private-work", "row_id": "private-row", "generation": 4, "timestamp": 10.4},
            {"sequence": 9, "category": "detail-row-image-image-area-zero", "route": "Detail", "work_id": "private-work",
             "parent_work_id": "private-work", "row_id": "private-row", "generation": 4, "timestamp": 10.5},
        ]
        result = summarize_detail_events(events, sequence_after=1, work_id="private-work", generation=4, started_at=10.0)
        self.assertEqual(result["source"], {"count": 1, "first_elapsed_ms": 200, "last_elapsed_ms": 200})
        self.assertEqual(result["fetch-error"], {"count": 1, "first_elapsed_ms": 1500, "last_elapsed_ms": 1500})
        self.assertEqual(result["image-source"], {"count": 1, "first_elapsed_ms": 300, "last_elapsed_ms": 300})
        self.assertEqual(result["image-area-positive"], {"count": 1, "first_elapsed_ms": 400, "last_elapsed_ms": 400})
        self.assertEqual(result["image-area-zero"], {"count": 1, "first_elapsed_ms": 500, "last_elapsed_ms": 500})
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
        frame_path = save_rejected_frame(frame, out_dir, "dark")
        summary = write_detail_summary(out_dir, theme="dark", accepted=False, failure="row-artwork-timeout",
                                       frame_path=frame_path, stages={"source": {"count": 1}})
        self.assertFalse(summary["accepted"])
        self.assertEqual(summary["theme"], "dark")
        self.assertEqual(frame.path, "private-capture/_debug/rejected-series-detail-dark.png")
        self.assertEqual(open_file.call_args.args[0], "private-capture/_debug/series-detail-dark-diagnostics.json")
        saved = json.loads("".join(call.args[0] for call in open_file().write.call_args_list))
        self.assertFalse(saved["accepted"])
        self.assertEqual(saved["theme"], "dark")
        self.assertEqual(saved["frame"], "_debug/rejected-series-detail-dark.png")
        self.assertNotIn("https://", json.dumps(saved))

    @patch("builtins.open", new_callable=mock_open)
    @patch("capture_diagnostics.os.makedirs")
    def test_dark_and_light_frames_and_summaries_keep_independent_results(self, makedirs, open_file):
        out_dir = "private-capture"
        dark_frame, light_frame = FakeFrame(), FakeFrame()
        dark_path = save_rejected_frame(dark_frame, out_dir, "dark")
        light_path = save_rejected_frame(light_frame, out_dir, "light")
        dark = write_detail_summary(out_dir, theme="dark", accepted=False, failure="row-artwork-timeout",
                                    frame_path=dark_path, stages={})
        light = write_detail_summary(out_dir, theme="light", accepted=True, failure=None,
                                     frame_path="light/series-detail.png", stages={"on-complete": {"count": 1}})
        self.assertNotEqual(dark_frame.path, light_frame.path)
        self.assertNotEqual(dark_path, light_path)
        self.assertFalse(dark["accepted"])
        self.assertTrue(light["accepted"])
        self.assertEqual(dark["theme"], "dark")
        self.assertEqual(light["theme"], "light")
        self.assertEqual(
            [call.args[0] for call in open_file.call_args_list],
            ["private-capture/_debug/series-detail-dark-diagnostics.json",
             "private-capture/_debug/series-detail-light-diagnostics.json"],
        )


if __name__ == "__main__":
    unittest.main()
