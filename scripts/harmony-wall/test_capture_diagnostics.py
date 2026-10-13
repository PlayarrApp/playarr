import io
import json
import unittest
from unittest.mock import MagicMock, mock_open, patch

from capture_diagnostics import (MAX_IMAGE_PAYLOAD_BYTES, analyze_episode_art_frame,
                                 decoded_art_is_accepted, image_payload_metrics,
                                 save_rejected_frame, summarize_detail_events,
                                 summarize_detail_image_payload_events, summarize_detail_layout_events,
                                 write_detail_summary)
from PIL import Image, ImageDraw


class FakeFrame:
    def save(self, path):
        self.path = path


class CaptureDiagnosticsTests(unittest.TestCase):
    def test_episode_art_guard_rejects_only_four_uniform_black_crops(self):
        black = Image.new("RGB", (1920, 1080), (0, 0, 0))
        result = analyze_episode_art_frame(black)
        self.assertEqual(result["status"], "uniformly-black-episode-art")
        self.assertEqual(result["uniformly_black_count"], 4)
        self.assertTrue(all(crop["mean_luma"] <= 4 and crop["stddev_luma"] <= 2
                            and crop["near_black_fraction"] >= 0.995 for crop in result["crops"]))

        textured = Image.new("RGB", (1920, 1080), (0, 0, 0))
        draw = ImageDraw.Draw(textured)
        for left, _, right, _ in ((888, 566, 1106, 681), (1141, 566, 1359, 681),
                                  (1394, 566, 1612, 681), (1647, 566, 1865, 681)):
            draw.rectangle((left, 566, right, 681), fill=(0, 0, 0))
            for x in range(left, right + 1, 2):
                draw.line((x, 566, x, 681), fill=(7 if x % 4 else 0,) * 3)
        textured_result = analyze_episode_art_frame(textured)
        self.assertEqual(textured_result["status"], "ok")
        self.assertEqual(textured_result["uniformly_black_count"], 0)
        self.assertTrue(all(crop["mean_luma"] <= 4 and crop["stddev_luma"] > 2
                            for crop in textured_result["crops"]))

    def test_episode_art_guard_allows_one_nonblack_crop_and_rejects_other_dimensions(self):
        mixed = Image.new("RGB", (1920, 1080), (0, 0, 0))
        ImageDraw.Draw(mixed).rectangle((1647, 566, 1865, 681), fill=(32, 32, 32))
        result = analyze_episode_art_frame(mixed)
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["uniformly_black_count"], 3)

        incompatible = analyze_episode_art_frame(Image.new("RGB", (1280, 720), (0, 0, 0)))
        self.assertEqual(incompatible["status"], "incompatible-dimensions")
        self.assertEqual(incompatible["crop_count"], 0)
        self.assertEqual((incompatible["width"], incompatible["height"]), (1280, 720))

    def test_decoded_art_requires_completion_and_a_passing_captured_frame(self):
        black = analyze_episode_art_frame(Image.new("RGB", (1920, 1080), (0, 0, 0)))
        self.assertFalse(decoded_art_is_accepted(True, black))

        textured = Image.new("RGB", (1920, 1080), (0, 0, 0))
        draw = ImageDraw.Draw(textured)
        for left, _, right, _ in ((888, 566, 1106, 681), (1141, 566, 1359, 681),
                                  (1394, 566, 1612, 681), (1647, 566, 1865, 681)):
            for x in range(left, right + 1, 2):
                draw.line((x, 566, x, 681), fill=(7 if x % 4 else 0,) * 3)
        accepted_frame = analyze_episode_art_frame(textured)
        self.assertTrue(decoded_art_is_accepted(True, accepted_frame))
        self.assertFalse(decoded_art_is_accepted(False, accepted_frame))

    def test_payload_metrics_include_alpha_channels_and_luma_but_malformed_is_enum_only(self):
        payload = io.BytesIO()
        sample = Image.new("RGBA", (2, 2), (1, 2, 3, 0))
        sample.putpixel((1, 0), (5, 6, 7, 255))
        sample.save(payload, "PNG")
        metrics = image_payload_metrics(payload.getvalue())
        self.assertEqual(metrics["decode_status"], "ok")
        self.assertEqual((metrics["width"], metrics["height"]), (2, 2))
        self.assertEqual((metrics["mean_red"], metrics["mean_green"], metrics["mean_blue"]), (2, 3, 4))
        self.assertTrue(all(metrics[key] > 0 for key in ("stddev_red", "stddev_green", "stddev_blue")))
        self.assertEqual(metrics["mean_alpha"], 63.75)
        self.assertEqual(metrics["transparent_fraction"], 0.75)
        self.assertEqual(metrics["near_black_fraction"], 1)
        malformed = image_payload_metrics(b"not an image payload")
        self.assertEqual(malformed, {"decode_status": "malformed"})

    def test_payload_metrics_reject_byte_and_pixel_limits_before_full_decode(self):
        with patch("PIL.Image.open") as image_open:
            oversized_bytes = image_payload_metrics(type("LargePayload", (), {
                "__len__": lambda self: MAX_IMAGE_PAYLOAD_BYTES + 1,
            })())
            self.assertEqual(oversized_bytes, {"decode_status": "oversized"})
            image_open.assert_not_called()

        image_context = MagicMock()
        image = MagicMock()
        image.size = (8192, 2048)
        image_context.__enter__.return_value = image
        with patch("PIL.Image.open", return_value=image_context):
            oversized_pixels = image_payload_metrics(b"header")
        self.assertEqual(oversized_pixels, {"decode_status": "oversized"})
        image.load.assert_not_called()

    def test_payload_summary_is_scoped_and_contains_only_aggregate_numeric_metrics(self):
        events = [
            {"sequence": 2, "category": "detail-image-payload-metrics", "route": "Detail",
             "work_id": "private-work", "parent_work_id": "private-work", "row_id": "private-row",
             "generation": 4, "image_id": "123", "url": "http://127.0.0.1/img/123",
             "width": 300, "height": 450, "mean_alpha": 255, "mean_luma": 16},
            {"sequence": 3, "category": "detail-image-payload-decode-error", "route": "Detail",
             "work_id": "private-work", "parent_work_id": "private-work", "row_id": "private-row",
             "generation": 4, "image_id": "124", "error": "private detail"},
            {"sequence": 4, "category": "detail-image-payload-metrics", "route": "Detail",
             "work_id": "other-work", "parent_work_id": "other-work", "row_id": "other-row",
             "generation": 4, "width": 999, "height": 999, "mean_luma": 0},
        ]
        summary = summarize_detail_image_payload_events(
            events, sequence_after=1, work_id="private-work", generation=4)
        self.assertEqual(summary["payload_count"], 1)
        self.assertEqual(summary["decode_error_count"], 1)
        self.assertEqual(summary["oversized_count"], 0)
        self.assertEqual(summary["mean_luma"], {"min": 16, "max": 16, "mean": 16})
        self.assertNotIn("image_id", json.dumps(summary))
        self.assertNotIn("private-work", json.dumps(summary))
        self.assertNotIn("private-row", json.dumps(summary))
        self.assertNotIn("127.0.0.1", json.dumps(summary))
        self.assertNotIn("private detail", json.dumps(summary))
        self.assertTrue(all(isinstance(value, int) or isinstance(value, dict)
                           for value in summary.values()))

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
            {"sequence": 10, "category": "detail-layout-rail-items-prop-update-count", "route": "Detail",
             "work_id": "private-work", "generation": 8, "timestamp": 10.8, "value": 5},
            {"sequence": 11, "category": "detail-layout-rail-items-prop-update-artwork-count", "route": "Detail",
             "work_id": "private-work", "generation": 8, "timestamp": 10.9, "value": 3},
            {"sequence": 12, "category": "detail-layout-rail-items-prop-update-artwork-count", "route": "Detail",
             "work_id": "private-work", "generation": 9, "timestamp": 11.0, "value": 99},
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
        self.assertEqual(result["rail-items-prop-update-count"]["value"], {"min": 5, "max": 5})
        self.assertEqual(result["rail-items-prop-update-artwork-count"]["value"], {"min": 3, "max": 3})
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
            {"sequence": 10, "category": "detail-row-image-row-match-found", "route": "Detail", "work_id": "private-work",
             "parent_work_id": "private-work", "row_id": "private-row", "generation": 4, "timestamp": 10.6},
            {"sequence": 10, "category": "detail-row-image-artwork-state-mutated", "route": "Detail", "work_id": "private-work",
             "parent_work_id": "private-work", "row_id": "private-row", "generation": 4, "timestamp": 10.65},
            {"sequence": 10, "category": "detail-row-image-artwork-store-updated", "route": "Detail", "work_id": "private-work",
             "parent_work_id": "private-work", "row_id": "private-row", "generation": 4, "timestamp": 10.66},
            {"sequence": 11, "category": "detail-row-image-poster-artwork-prop-present", "route": "Detail", "work_id": "private-work",
             "parent_work_id": "private-work", "row_id": "private-row", "generation": 4, "timestamp": 10.7},
            {"sequence": 12, "category": "detail-row-image-poster-render-artwork-present", "route": "Detail", "work_id": "private-work",
             "parent_work_id": "private-work", "row_id": "private-row", "generation": 4, "timestamp": 10.8},
            {"sequence": 13, "category": "detail-row-image-visible-item-artwork-state-absent", "route": "Detail", "work_id": "private-work",
             "parent_work_id": "private-work", "row_id": "private-row", "generation": 4, "timestamp": 10.9},
            {"sequence": 15, "category": "detail-row-image-visible-item-artwork-state-present", "route": "Detail", "work_id": "private-work",
             "parent_work_id": "private-work", "row_id": "private-row", "generation": 4, "timestamp": 11.1},
            {"sequence": 14, "category": "detail-row-image-poster-artwork-prop-present", "route": "Detail", "work_id": "other-work",
             "parent_work_id": "other-work", "row_id": "other-row", "generation": 4, "timestamp": 11.0},
        ]
        result = summarize_detail_events(events, sequence_after=1, work_id="private-work", generation=4, started_at=10.0)
        self.assertEqual(result["source"], {"count": 1, "first_elapsed_ms": 200, "last_elapsed_ms": 200})
        self.assertEqual(result["fetch-error"], {"count": 1, "first_elapsed_ms": 1500, "last_elapsed_ms": 1500})
        self.assertEqual(result["image-source"], {"count": 1, "first_elapsed_ms": 300, "last_elapsed_ms": 300})
        self.assertEqual(result["image-area-positive"], {"count": 1, "first_elapsed_ms": 400, "last_elapsed_ms": 400})
        self.assertEqual(result["image-area-zero"], {"count": 1, "first_elapsed_ms": 500, "last_elapsed_ms": 500})
        self.assertEqual(result["row-match-found"], {"count": 1, "first_elapsed_ms": 600, "last_elapsed_ms": 600})
        self.assertEqual(result["artwork-state-mutated"], {"count": 1, "first_elapsed_ms": 650, "last_elapsed_ms": 650})
        self.assertEqual(result["artwork-store-updated"], {"count": 1, "first_elapsed_ms": 660, "last_elapsed_ms": 660})
        self.assertEqual(result["poster-artwork-prop-present"], {"count": 1, "first_elapsed_ms": 700, "last_elapsed_ms": 700})
        self.assertEqual(result["poster-render-artwork-present"], {"count": 1, "first_elapsed_ms": 800, "last_elapsed_ms": 800})
        self.assertEqual(result["visible-item-artwork-state-absent"], {"count": 1, "first_elapsed_ms": 900, "last_elapsed_ms": 900})
        self.assertEqual(result["visible-item-artwork-state-present"], {"count": 1, "first_elapsed_ms": 1100, "last_elapsed_ms": 1100})
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
                                       frame_path=frame_path, stages={"source": {"count": 1}},
                                       payload_metrics={"payload_count": 1, "mean_luma": {"min": 1, "max": 2, "mean": 1.5}},
                                       episode_art={"status": "ok", "crop_count": 4})
        self.assertFalse(summary["accepted"])
        self.assertEqual(summary["theme"], "dark")
        self.assertEqual(frame.path, "private-capture/_debug/rejected-series-detail-dark.png")
        self.assertEqual(open_file.call_args.args[0], "private-capture/_debug/series-detail-dark-diagnostics.json")
        saved = json.loads("".join(call.args[0] for call in open_file().write.call_args_list))
        self.assertFalse(saved["accepted"])
        self.assertEqual(saved["theme"], "dark")
        self.assertEqual(saved["frame"], "_debug/rejected-series-detail-dark.png")
        self.assertEqual(saved["payload_metrics"]["payload_count"], 1)
        self.assertEqual(saved["episode_art"], {"status": "ok", "crop_count": 4})
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
