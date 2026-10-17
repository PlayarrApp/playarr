import io
import os
import json
import unittest
from unittest.mock import MagicMock, mock_open, patch

from capture_diagnostics import (MAX_IMAGE_PAYLOAD_BYTES, analyze_episode_art_frame,
                                 decoded_art_is_accepted, episode_art_events_ready, image_payload_metrics,
                                 save_rejected_frame, summarize_detail_events,
                                 summarize_detail_image_payload_events, summarize_detail_layout_events,
                                 series_focus_failure, previewer_focus_unavailable, write_detail_summary, confirm_detail_route_source,
                                 summarize_detail_load_events, phone_flat_card_rows, preview_focus_confirmed,
                                 home_recent_flat, posters_stalled, tv_flat_card_blocks)
from PIL import Image, ImageDraw


class FakeFrame:
    def save(self, path):
        self.path = path


class PhonePlaceholderTests(unittest.TestCase):
    def test_real_phone_frame_with_grey_episode_cards_is_flagged(self):
        # a crop of the series-detail frame in hosted run 38618985458 (dark), accepted at the time with both cards still grey
        frame = Image.open(os.path.join(os.path.dirname(__file__), "fixtures", "phone-series-detail-placeholders.png"))
        self.assertGreaterEqual(phone_flat_card_rows(frame), 1)

    def test_drawn_art_and_narrow_buttons_are_not_flagged(self):
        frame = Image.new("RGB", (1080, 1000), (21, 19, 22))
        draw = ImageDraw.Draw(frame)
        draw.rounded_rectangle((36, 100, 436, 232), 40, fill=(49, 42, 49))  # a 400 px pill: narrower than a card
        art = Image.effect_noise((561, 315), 80).convert("RGB")
        frame.paste(art, (36, 400))
        self.assertEqual(phone_flat_card_rows(frame), 0)


class CaptureDiagnosticsTests(unittest.TestCase):
    def test_preview_telemetry_fatal_marker_remains_latched_across_screens(self):
        import ast
        import tempfile
        from pathlib import Path

        source = Path(__file__).with_name("capture.py").read_text(encoding="utf-8")
        module = ast.parse(source, filename="capture.py")
        function = next(node for node in module.body
                        if isinstance(node, ast.FunctionDef) and node.name == "assert_preview_telemetry_clean")
        guarded = next(node for node in module.body
                       if isinstance(node, ast.FunctionDef) and node.name == "guarded")
        with tempfile.TemporaryDirectory() as scratch:
            preview_log = Path(scratch) / "previewer.log"
            preview_log.write_bytes(b"PLAYARR_PREVIEW_TELEMETRY_FAILED: delivery exhausted")
            namespace = {
                "PREVIEW_TELEMETRY_LOG_OFFSET": 0,
                "PREVIEW_TELEMETRY_LOG_TAIL": b"",
                "PREVIEW_TELEMETRY_FATAL": False,
                "log": str(preview_log),
                "open": open,
                "os": os,
                "SystemExit": SystemExit,
            }
            exec(compile(ast.Module(body=[function], type_ignores=[]), "capture.py", "exec"), namespace)
            with self.assertRaisesRegex(SystemExit, "telemetry transport failed"):
                namespace["assert_preview_telemetry_clean"]()
            namespace.update({"MISSING": [], "Skip": Exception, "print": lambda *args, **kwargs: None})
            exec(compile(ast.Module(body=[guarded], type_ignores=[]), "capture.py", "exec"), namespace)
            with self.assertRaisesRegex(SystemExit, "telemetry transport failed"):
                namespace["guarded"]("sample", namespace["assert_preview_telemetry_clean"])
            self.assertEqual(namespace["MISSING"], [])
            preview_log.write_bytes(b"")
            with self.assertRaisesRegex(SystemExit, "telemetry transport failed"):
                namespace["assert_preview_telemetry_clean"]()

    def test_missing_preview_telemetry_log_remains_fatal_across_screens(self):
        import ast
        from pathlib import Path

        source = Path(__file__).with_name("capture.py").read_text(encoding="utf-8")
        module = ast.parse(source, filename="capture.py")
        function = next(node for node in module.body
                        if isinstance(node, ast.FunctionDef) and node.name == "assert_preview_telemetry_clean")
        guarded = next(node for node in module.body
                       if isinstance(node, ast.FunctionDef) and node.name == "guarded")
        namespace = {
            "PREVIEW_TELEMETRY_LOG_OFFSET": 0,
            "PREVIEW_TELEMETRY_LOG_TAIL": b"",
            "PREVIEW_TELEMETRY_FATAL": False,
            "log": "missing-preview-log",
            "open": MagicMock(side_effect=OSError("missing")),
            "os": os,
            "SystemExit": SystemExit,
        }
        exec(compile(ast.Module(body=[function], type_ignores=[]), "capture.py", "exec"), namespace)
        with self.assertRaisesRegex(SystemExit, "could not verify preview telemetry log"):
            namespace["assert_preview_telemetry_clean"]()
        self.assertTrue(namespace["PREVIEW_TELEMETRY_FATAL"])
        namespace.update({"MISSING": [], "Skip": Exception, "print": lambda *args, **kwargs: None})
        exec(compile(ast.Module(body=[guarded], type_ignores=[]), "capture.py", "exec"), namespace)
        with self.assertRaisesRegex(SystemExit, "preview telemetry transport failed"):
            namespace["guarded"]("sample", namespace["assert_preview_telemetry_clean"])
        self.assertEqual(namespace["MISSING"], [])

    def test_preview_focus_ack_requires_live_card_and_capture_aborts_without_it(self):
        import ast
        import json as json_module
        from pathlib import Path
        from unittest.mock import Mock

        self.assertFalse(preview_focus_confirmed({"focus_ack": None}))
        self.assertFalse(preview_focus_confirmed({"focus_ack": "none"}))
        self.assertTrue(preview_focus_confirmed({"focus_ack": "ok:42,96"}))

        source = Path(__file__).with_name("capture.py").read_text(encoding="utf-8")
        module = ast.parse(source, filename="capture.py")
        function = next(node for node in module.body
                        if isinstance(node, ast.FunctionDef) and node.name == "focus_first_card")
        namespace = {
            "get": Mock(return_value=b"ok"),
            "json": json_module,
            "time": Mock(sleep=Mock()),
            "preview_focus_confirmed": preview_focus_confirmed,
            "assert_preview_telemetry_clean": Mock(),
            "SystemExit": SystemExit,
            "print": Mock(),
        }
        exec(compile(ast.Module(body=[function], type_ignores=[]), "capture.py", "exec"), namespace)
        namespace["get"].side_effect = [b"ok", b"ok", b'{"focus_ack":"ok:42,96"}']
        self.assertIsNone(namespace["focus_first_card"]())

        namespace["get"].side_effect = [b"ok", b"ok"] + [b'{"focus_ack":null}'] * 10
        with self.assertRaisesRegex(SystemExit, "no live card acknowledged focus"):
            namespace["focus_first_card"]()

        namespace["assert_preview_telemetry_clean"].side_effect = SystemExit("preview telemetry transport failed")
        namespace["get"].side_effect = None
        with self.assertRaisesRegex(SystemExit, "preview telemetry transport failed"):
            namespace["focus_first_card"]()

    def test_detail_load_summary_is_redacted_scoped_and_reports_input_before_focus(self):
        events = [
            {"sequence": 4, "category": "detail-load-load-start", "route": "Detail",
             "work_id": "private-work", "generation": 8, "load_sequence": 3,
             "render_state": "loading", "title": "secret"},
            {"sequence": 5, "category": "detail-load-api-result", "route": "Detail",
             "work_id": "private-work", "generation": 8, "load_sequence": 3,
             "render_state": "loading", "result_category": "http_failure", "status": 503,
             "error_category": "general", "message": "secret", "url": "https://private.example"},
            {"sequence": 6, "category": "detail-load-render-state", "route": "Detail",
             "work_id": "private-work", "generation": 8, "load_sequence": 3,
             "render_state": "error"},
            {"sequence": 7, "category": "detail-load-render-state", "route": "Detail",
             "work_id": "other-work", "generation": 8, "load_sequence": 3,
             "render_state": "detail-ready"},
        ]
        summary = summarize_detail_load_events(events, sequence_after=3, work_id="private-work",
                                               generation=8, remote_input_sent_before_focus_assertion=False)
        encoded = json.dumps(summary)
        self.assertEqual(summary["route_generation"], 8)
        self.assertEqual(len(summary["events"]), 3)
        self.assertEqual(summary["events"][1]["status"], 503)
        self.assertEqual(summary["events"][2]["render_state"], "error")
        self.assertFalse(summary["remote_input_sent_before_focus_assertion"])
        self.assertNotIn("private-work", encoded)
        self.assertNotIn("secret", encoded)
        self.assertNotIn("private.example", encoded)

    def test_final_detail_state_callback_runs_immediately_before_screenshot(self):
        from pathlib import Path
        source = (Path(__file__).with_name("capture.py")).read_text(encoding="utf-8")
        snap_body = source.split("def snap_checked(", 1)[1].split("\ndef debug(", 1)[0]
        self.assertLess(snap_body.index("before_frame()"), snap_body.index("img = png()"))
        detail_flow = source.split("def capture_selected_detail(", 1)[1].split("def capture_selected(", 1)[0]
        self.assertIn('before_frame=capture_final_state if name == "series-detail" else None', detail_flow)
        self.assertIn("summarize_detail_load_events", source)
    @staticmethod
    def episode_events(*, target="row-a", missing_area=(), missing_completion=(), sequence_after=0):
        rows = (("row-a", 120, 426), ("row-b", 420, 426),
                ("row-c", 120, 716), ("row-d", 420, 716))
        events = [{"sequence": 1, "category": "detail-episode-target", "route": "Detail",
                   "work_id": "work-a", "parent_work_id": "work-a", "row_id": target, "generation": 7}]
        sequence = 2
        for row_id, x, y in rows:
            events.append({"sequence": sequence, "category": "detail-episode-card-container-area", "route": "Detail",
                           "work_id": "work-a", "parent_work_id": "work-a", "row_id": row_id,
                           "generation": 7, "x_vp": x / 2, "y_vp": y / 2,
                           "width_vp": 134, "height_vp": 95, "density": 2})
            sequence += 1
            if row_id not in missing_area:
                events.append({"sequence": sequence, "category": "detail-episode-card-area", "route": "Detail",
                               "work_id": "work-a", "parent_work_id": "work-a", "row_id": row_id,
                               "generation": 7, "x_vp": x / 2, "y_vp": y / 2,
                               "width_vp": 134, "height_vp": 75.5, "density": 2})
                sequence += 1
                events.append({"sequence": sequence, "category": "detail-row-image-image-area-positive",
                               "route": "Detail", "work_id": "work-a", "parent_work_id": "work-a",
                               "row_id": row_id, "generation": 7})
                sequence += 1
            if row_id not in missing_completion:
                events.append({"sequence": sequence, "category": "detail-row-image-on-complete",
                               "route": "Detail", "work_id": "work-a", "parent_work_id": "work-a",
                               "row_id": row_id, "generation": 7})
                sequence += 1
        return [event for event in events if event["sequence"] > sequence_after]

    @staticmethod
    def art_frame(placeholder_rows=(), black_rows=()):
        image = Image.new("RGB", (1920, 1080), (0, 0, 0))
        draw = ImageDraw.Draw(image)
        rows = (("row-a", 120, 426), ("row-b", 420, 426),
                ("row-c", 120, 716), ("row-d", 420, 716))
        for row_id, left, top in rows:
            if row_id in placeholder_rows:
                draw.rectangle((left, top, left + 267, top + 150), fill=(221, 221, 221))
                for x in range(left, left + 268, 2):
                    draw.line((x, top, x, top + 150), fill=(216, 216, 216) if x % 4 else (226, 226, 226))
            elif row_id in black_rows:
                draw.rectangle((left, top, left + 267, top + 150), fill=(0, 0, 0))
            else:
                for x in range(left, left + 268, 2):
                    draw.line((x, top, x, top + 150), fill=(36, 48, 61) if x % 4 else (148, 128, 108))
        return image

    def test_route_confirmation_survives_later_fail_closed_capture(self):
        detail_sources = {}
        manifest = {"missing": [], "series_detail_accepted": {}}
        confirmed_state = {"route": "Detail", "work_id": "work-a"}
        with self.assertRaisesRegex(RuntimeError, "row-artwork-timeout"):
            self.assertTrue(confirm_detail_route_source(detail_sources, "series-detail", confirmed_state, "work-a"))
            manifest["missing"].append("series-detail")
            raise RuntimeError("row-artwork-timeout")

        self.assertEqual(detail_sources["series-detail"], {
            "route": "Detail", "source": "suite.json:open", "route_confirmed": True,
        })
        self.assertEqual(manifest["missing"], ["series-detail"])
        self.assertNotIn("series-detail", manifest["series_detail_accepted"])
        self.assertFalse(confirm_detail_route_source(detail_sources, "series-detail",
                                                     {"route": "Detail", "work_id": "other"}, "work-a"))

    def test_episode_art_guard_uses_fresh_geometry_and_accepts_textured_visible_rows(self):
        events = self.episode_events()
        frame = self.art_frame()
        self.assertTrue(episode_art_events_ready(events, sequence_after=0, work_id="work-a", generation=7))
        result = analyze_episode_art_frame(frame, events=events, sequence_after=0,
                                           work_id="work-a", generation=7)
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["visible_row_count"], 4)
        self.assertTrue(result["target_visible"])
        self.assertEqual(result["crop_count"], 4)
        self.assertTrue(all(crop["width"] == 268 and crop["height"] == 151 for crop in result["crops"]))
        self.assertTrue(all(crop["stddev_luma"] > 8 for crop in result["crops"]))
        self.assertTrue(decoded_art_is_accepted(True, result))
        self.assertFalse(decoded_art_is_accepted(False, result))

    def test_container_area_diagnostics_report_scoped_counts_bounds_and_rejection_reason(self):
        events = self.episode_events()
        events.extend([
            {"sequence": 100, "category": "detail-layout-episode-card-container-report",
             "route": "Detail", "work_id": "work-a", "generation": 7, "report_invoked": 1,
             "sender_route_ok": 1, "sender_work_present": 1, "sender_work_matches": 1,
             "sender_generation_matches": 1, "sender_rect_finite": 1, "sender_rect_positive": 1,
             "sender_density_valid": 1, "x_vp": 60, "y_vp": 213, "width_vp": 134,
             "height_vp": 95, "density": 2},
        ])
        result = analyze_episode_art_frame(self.art_frame(), events=events, sequence_after=0,
                                           work_id="work-a", generation=7)
        self.assertEqual(result["container_area_report_count"], 1)
        self.assertEqual(result["container_area_receiver_accept_count"], 4)
        self.assertEqual(result["container_area_receiver_reject_count"], 0)
        self.assertEqual(result["container_area_candidate_count"], 4)
        self.assertEqual(result["container_area_geometry_vp"]["width_vp"], {"min": 134, "max": 134})
        self.assertEqual(result["container_area_rejection_reason"], "none")

        rejected = [event for event in events if event["category"] != "detail-episode-card-container-area"]
        rejected.append({"sequence": 101, "category": "detail-layout-episode-card-container-receiver",
                         "route": "Detail", "work_id": "work-a", "generation": 7,
                         "accepted": 0, "reason_code": 4})
        failure = analyze_episode_art_frame(self.art_frame(), events=rejected, sequence_after=0,
                                            work_id="work-a", generation=7)
        self.assertEqual(failure["container_area_candidate_count"], 0)
        self.assertEqual(failure["container_area_receiver_reject_count"], 1)
        self.assertEqual(failure["container_area_rejection_reason"],
                         "receiver-nonpositive-or-invalid-density")
        encoded = json.dumps(failure)
        self.assertNotIn('"work_id": "work-a"', encoded)
        self.assertNotIn("row-a", encoded)

    def test_episode_art_crop_guard_joins_image_bounds_only_for_container_rows(self):
        events = self.episode_events()
        events.extend([
            {"sequence": 50, "category": "detail-episode-card-area", "route": "Detail",
             "work_id": "work-a", "parent_work_id": "work-a", "row_id": "unlisted-card",
             "generation": 7, "x_vp": 20, "y_vp": 20, "width_vp": 134, "height_vp": 75.5, "density": 2},
            {"sequence": 51, "category": "detail-row-image-image-area-positive", "route": "Detail",
             "work_id": "work-a", "parent_work_id": "work-a", "row_id": "unlisted-card", "generation": 7},
            {"sequence": 52, "category": "detail-row-image-on-complete", "route": "Detail",
             "work_id": "work-a", "parent_work_id": "work-a", "row_id": "unlisted-card", "generation": 7},
        ])
        result = analyze_episode_art_frame(self.art_frame(), events=events, sequence_after=0,
                                           work_id="work-a", generation=7)
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["visible_row_count"], 4)
        self.assertEqual(result["crop_count"], 4)

    def test_episode_art_guard_rejects_blank_visible_card_and_missing_row_events(self):
        events = self.episode_events()
        blank_result = analyze_episode_art_frame(self.art_frame(("row-c",)), events=events,
                                                 sequence_after=0, work_id="work-a", generation=7)
        self.assertEqual(blank_result["status"], "placeholder-episode-art")
        self.assertEqual(blank_result["placeholder_count"], 1)
        self.assertFalse(decoded_art_is_accepted(True, blank_result))

        black_result = analyze_episode_art_frame(self.art_frame(black_rows=("row-d",)), events=events,
                                                 sequence_after=0, work_id="work-a", generation=7)
        self.assertEqual(black_result["status"], "placeholder-episode-art")
        self.assertEqual(black_result["placeholder_count"], 1)

        missing_completion = self.episode_events(missing_completion=("row-d",))
        self.assertFalse(episode_art_events_ready(missing_completion, sequence_after=0,
                                                  work_id="work-a", generation=7))
        incomplete = analyze_episode_art_frame(self.art_frame(), events=missing_completion,
                                               sequence_after=0, work_id="work-a", generation=7)
        self.assertEqual(incomplete["status"], "visible-row-image-completion-missing")

        missing_area = self.episode_events(missing_area=("row-b",))
        self.assertEqual(analyze_episode_art_frame(self.art_frame(), events=missing_area, sequence_after=0,
                                                   work_id="work-a", generation=7)["status"],
                         "visible-row-image-area-missing")

    def test_episode_art_guard_rejects_missing_target_stale_geometry_and_partial_rectangles(self):
        no_target = [event for event in self.episode_events() if event["category"] != "detail-episode-target"]
        result = analyze_episode_art_frame(self.art_frame(), events=no_target, sequence_after=0,
                                           work_id="work-a", generation=7)
        self.assertEqual(result["status"], "target-not-reported")

        stale = self.episode_events(sequence_after=100)
        self.assertFalse(episode_art_events_ready(stale, sequence_after=100, work_id="work-a", generation=7))
        self.assertEqual(analyze_episode_art_frame(self.art_frame(), events=stale, sequence_after=100,
                                                   work_id="work-a", generation=7)["status"],
                         "target-not-reported")

        partial = self.episode_events()
        geometry = next(event for event in partial if event["category"] == "detail-episode-card-container-area" and event["row_id"] == "row-a")
        geometry["x_vp"] = -1
        self.assertEqual(analyze_episode_art_frame(self.art_frame(), events=partial, sequence_after=0,
                                                   work_id="work-a", generation=7)["status"],
                         "target-not-fully-visible")

    def test_episode_art_guard_accepts_textured_visible_intersection_for_non_target_card(self):
        events = self.episode_events()
        geometry = next(event for event in events if event["category"] == "detail-episode-card-area"
                        and event["row_id"] == "row-b")
        geometry["x_vp"] = 885
        container = next(event for event in events if event["category"] == "detail-episode-card-container-area"
                         and event["row_id"] == "row-b")
        container["x_vp"] = 885
        frame = self.art_frame()
        draw = ImageDraw.Draw(frame)
        for x in range(1770, 1920, 2):
            draw.line((x, 426, x, 576), fill=(36, 48, 61) if x % 4 else (148, 128, 108))

        self.assertTrue(episode_art_events_ready(events, sequence_after=0, work_id="work-a", generation=7))
        result = analyze_episode_art_frame(frame, events=events, sequence_after=0,
                                           work_id="work-a", generation=7)
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["partial_card_count"], 1)
        self.assertTrue(result["target_fully_visible"])
        self.assertEqual(result["crop_count"], 4)
        self.assertEqual(result["crops"][1]["width"], 150)
        self.assertEqual(result["crops"][1]["left_px"], 1770)
        self.assertEqual(result["crops"][1]["visible_width_px"], 150)
        self.assertTrue(all(isinstance(crop["is_target"], bool) for crop in result["crops"]))

    def test_episode_art_guard_fails_closed_on_invalid_scoped_geometry(self):
        events = self.episode_events()
        invalid = next(event for event in events if event["category"] == "detail-episode-card-area"
                       and event["row_id"] == "row-b")
        invalid["width_vp"] = 0
        result = analyze_episode_art_frame(self.art_frame(), events=events, sequence_after=0,
                                           work_id="work-a", generation=7)
        self.assertEqual(result["status"], "invalid-card-geometry")
        self.assertEqual(result["invalid_geometry_count"], 1)
        self.assertFalse(episode_art_events_ready(events, sequence_after=0, work_id="work-a", generation=7))

        incompatible = analyze_episode_art_frame(Image.new("RGB", (1280, 720)), events=self.episode_events(),
                                                sequence_after=0, work_id="work-a", generation=7)
        self.assertEqual(incompatible["status"], "incompatible-dimensions")
        self.assertEqual(incompatible["crop_count"], 0)

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

    def test_series_focus_and_target_geometry_stages_are_allowlisted_and_numeric_only(self):
        events = [
            {"sequence": 4, "category": "detail-layout-series-focus-request-count", "route": "Detail",
             "work_id": "private-work", "generation": 13, "timestamp": 20.1, "value": 1,
             "episode_id": "private-episode", "title": "Private title", "url": "https://private.example"},
            {"sequence": 5, "category": "detail-layout-series-focused-row-is-target", "route": "Detail",
             "work_id": "private-work", "generation": 13, "timestamp": 20.2, "value": 1,
             "row_id": "private-episode", "title": "Private title"},
            {"sequence": 6, "category": "detail-layout-series-target-season-row-area", "route": "Detail",
             "work_id": "private-work", "generation": 13, "timestamp": 20.3,
             "value": 1, "width": 900, "height": 340, "row_id": "private-season"},
            {"sequence": 7, "category": "detail-layout-series-target-season-centre-delta-vp", "route": "Detail",
             "work_id": "private-work", "generation": 13, "timestamp": 20.4,
             "value": -18, "width": 900, "height": 340, "url": "https://private.example"},
            {"sequence": 9, "category": "detail-layout-series-focused-row-is-target", "route": "Detail",
             "work_id": "private-work", "generation": 12, "timestamp": 20.6, "value": 1,
             "row_id": "stale-private-episode"},
            {"sequence": 8, "category": "detail-layout-series-focused-row-is-target", "route": "Detail",
             "work_id": "private-work", "generation": 13, "timestamp": 20.5, "value": 0,
             "row_id": "another-private-episode", "title": "Other private title"},
            {"sequence": 10, "category": "detail-layout-series-target-card-visibility", "route": "Detail",
             "work_id": "private-work", "generation": 13, "timestamp": 20.7, "visible": 1,
             "intersection_width_vp": 540, "intersection_height_vp": 330, "page_offset_vp": -229,
             "rail_offset_vp": 0, "offsets_fresh": 1, "row_id": "private-episode"},
            {"sequence": 11, "category": "detail-layout-series-focus-request-issued", "route": "Detail",
             "work_id": "private-work", "generation": 13, "timestamp": 20.8, "value": 1},
            {"sequence": 12, "category": "detail-layout-series-focus-request-result", "route": "Detail",
             "work_id": "private-work", "generation": 13, "timestamp": 20.9, "value": 1},
        ]
        summary = summarize_detail_layout_events(events, sequence_after=3, work_id="private-work",
                                                 generation=13, started_at=20.0)
        expected_stages = (
            "series-focus-request-count", "series-focused-row-is-target",
            "series-target-season-row-area", "series-target-season-centre-delta-vp",
            "series-target-card-visibility", "series-focus-request-issued", "series-focus-request-result",
        )
        self.assertEqual(set(summary), set(expected_stages))
        for stage in expected_stages:
            self.assertEqual(summary[stage]["count"], 2 if stage == "series-focused-row-is-target" else 1)
        self.assertEqual(summary["series-focus-request-count"]["value"], {"min": 1, "max": 1})
        self.assertEqual(summary["series-focused-row-is-target"]["value"], {"min": 0, "max": 1})
        self.assertEqual(summary["series-focused-row-is-target"]["last_value"], 0)
        self.assertEqual(summary["series-target-season-row-area"]["width"], {"min": 900, "max": 900})
        self.assertEqual(summary["series-target-season-centre-delta-vp"]["value"], {"min": -18, "max": -18})
        self.assertEqual(summary["series-target-season-centre-delta-vp"]["last_value"], -18)
        self.assertEqual(summary["series-target-card-visibility"]["visible"]["last_value"], 1)
        self.assertEqual(summary["series-target-card-visibility"]["page_offset_vp"]["last_value"], -229)
        self.assertEqual(summary["series-focus-request-issued"]["last_value"], 1)
        self.assertEqual(summary["series-focus-request-result"]["last_value"], 1)

        def only_numeric_leaves(value):
            if isinstance(value, dict):
                return all(only_numeric_leaves(item) for item in value.values())
            return isinstance(value, (int, float)) and not isinstance(value, bool)

        self.assertTrue(only_numeric_leaves(summary))
        serialized = json.dumps(summary)
        for private_value in ("private-work", "private-episode", "another-private-episode", "stale-private-episode",
                              "private-season", "Private title", "Other private title", "https://"):
            self.assertNotIn(private_value, serialized)

    def test_series_acceptance_uses_top_visible_target_fresh_offsets_and_actual_focus(self):
        episode_metrics = {"target_fully_visible": True}
        complete = {
            "series-focused-row-is-target": {"last_value": 1, "count": 2},
            "series-focus-request-issued": {"last_value": 1, "count": 1},
            "series-focus-request-result": {"last_value": 1, "count": 1},
            "series-target-card-visibility": {
                "visible": {"last_value": 1}, "offsets_fresh": {"last_value": 1},
                "intersection_width_vp": {"last_value": 540}, "intersection_height_vp": {"last_value": 330},
                "page_offset_vp": {"last_value": -229}, "rail_offset_vp": {"last_value": 0},
            },
        }
        self.assertIsNone(series_focus_failure(complete, episode_metrics))
        already_focused = {**complete, "series-focus-request-issued": {"last_value": 0, "count": 1}}
        self.assertIsNone(series_focus_failure(already_focused, episode_metrics))
        threw = {"series-focus-request-count": {"value": {"min": 1, "max": 3}}, "series-focus-request-issued": {"last_value": 0, "value": {"min": 0, "max": 0}}}
        self.assertTrue(previewer_focus_unavailable(threw))
        self.assertFalse(previewer_focus_unavailable(already_focused))
        self.assertFalse(previewer_focus_unavailable({**threw, "series-focus-request-issued": {"last_value": 1, "value": {"min": 0, "max": 1}}}))
        self.assertEqual(series_focus_failure({**complete, "series-focused-row-is-target": {
            "last_value": 0, "count": 2,
        }}, episode_metrics), "focus-not-target")
        stale = {**complete, "series-target-card-visibility": {
            **complete["series-target-card-visibility"], "offsets_fresh": {"last_value": 0},
        }}
        self.assertEqual(series_focus_failure(stale, episode_metrics), "target-visibility-or-offsets-missing")
        self.assertEqual(series_focus_failure(complete, {"target_fully_visible": False}),
                         "target-art-not-fully-visible")
        request_failed = {**complete, "series-focus-request-result": {"last_value": 0, "count": 1}}
        self.assertEqual(series_focus_failure(request_failed, episode_metrics), "focus-request-not-accepted")

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


class PosterStallGuardTests(unittest.TestCase):
    def home(self, art):
        frame = Image.new("RGB", (1920, 1080), (250, 249, 248))
        draw = ImageDraw.Draw(frame)
        for x in (882, 1234, 1586):
            draw.rectangle((x, 809, x + 326, 992), fill=(224, 222, 223))
            if art:
                for i in range(0, 300, 10):
                    draw.rectangle((x + i, 809, x + i + 5, 992), fill=(i % 255, (i * 3) % 255, (i * 7) % 255))
        return frame

    def test_grey_recent_cards_are_stalled(self):
        frame = self.home(art=False)
        self.assertTrue(home_recent_flat(frame))
        self.assertGreaterEqual(tv_flat_card_blocks(frame), 2)
        self.assertTrue(posters_stalled("home", 70, tv_flat_card_blocks(frame), True))

    def test_drawn_posters_pass(self):
        frame = self.home(art=True)
        self.assertFalse(home_recent_flat(frame))
        self.assertFalse(posters_stalled("home", 70, tv_flat_card_blocks(frame), False))

    def test_home_with_few_completed_images_is_stalled_other_screens_are_not(self):
        self.assertTrue(posters_stalled("home", 5, 0))
        self.assertFalse(posters_stalled("movies", 5, 0))
        self.assertFalse(posters_stalled("home", None, 0))
