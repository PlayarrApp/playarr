import io
import json
import sys
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch
from PIL import Image

HERE = Path(__file__).resolve().parent
sys.path.extend((str(HERE), str(HERE.parent / "sim-vnc")))
import harmony_vnc
import patch_state
import patch_rail
from capture_diagnostics import (analyze_episode_art_frame, decoded_art_is_accepted, episode_art_events_ready,
                                 summarize_detail_image_payload_events, summarize_detail_layout_events)


class PreviewEventTests(unittest.TestCase):
    def setUp(self):
        self.state = dict(harmony_vnc.STATE)
        self.sequence = harmony_vnc.DEBUG_SEQUENCE
        self.images = dict(harmony_vnc.IMAGES)
        self.image_metrics = dict(harmony_vnc.IMAGE_METRICS)
        self.image_scopes = dict(harmony_vnc.IMAGE_SCOPES)
        harmony_vnc.STATE.clear()
        harmony_vnc.STATE.update({"route": "", "kind": "", "focused": None, "lib_kind": ""})
        harmony_vnc.DEBUG_SEQUENCE = 0
        harmony_vnc.IMAGES.clear()
        harmony_vnc.IMAGE_METRICS.clear()
        harmony_vnc.IMAGE_SCOPES.clear()

    def tearDown(self):
        harmony_vnc.STATE.clear()
        harmony_vnc.STATE.update(self.state)
        harmony_vnc.DEBUG_SEQUENCE = self.sequence
        harmony_vnc.IMAGES.clear()
        harmony_vnc.IMAGES.update(self.images)
        harmony_vnc.IMAGE_METRICS.clear()
        harmony_vnc.IMAGE_METRICS.update(self.image_metrics)
        harmony_vnc.IMAGE_SCOPES.clear()
        harmony_vnc.IMAGE_SCOPES.update(self.image_scopes)

    def test_image_payload_metrics_join_ephemeral_key_to_current_row_without_exporting_ids(self):
        harmony_vnc.apply_state({
            "route": ["Detail"], "kind": [""], "work": ["work-private"], "generation": ["9"],
        })
        data = io.BytesIO()
        Image.new("RGBA", (3, 2), (1, 2, 3, 128)).save(data, "PNG")
        harmony_vnc.record_image_upload("734", data.getvalue())
        self.assertIn("734", harmony_vnc.IMAGE_METRICS)
        accepted = harmony_vnc.append_detail_image_payload_scope({
            "route": "Detail", "work_id": "work-private", "parent_work_id": "work-private",
            "row_id": "row-private", "generation": 9, "image_id": "734",
        })
        self.assertTrue(accepted)
        event = harmony_vnc.STATE["debug_events"][-1]
        self.assertEqual(event["category"], "detail-image-payload-metrics")
        self.assertEqual(event["mean_alpha"], 128)
        self.assertNotIn("image_id", event)
        self.assertNotIn("734", json.dumps(event))
        summary = summarize_detail_image_payload_events(
            harmony_vnc.STATE["debug_events"], sequence_after=0,
            work_id="work-private", generation=9)
        encoded = json.dumps(summary)
        self.assertEqual(summary["payload_count"], 1)
        self.assertEqual(summary["mean_alpha"]["mean"], 128)
        self.assertNotIn("work-private", encoded)
        self.assertNotIn("row-private", encoded)
        self.assertNotIn("734", encoded)
        self.assertNotIn("/img/", encoded)
        self.assertEqual(harmony_vnc.IMAGE_SCOPES, {})
        self.assertEqual(harmony_vnc.IMAGE_METRICS, {})

    def test_detail_load_success_failure_and_new_sequence_are_scoped(self):
        harmony_vnc.apply_state({"route": ["Detail"], "kind": [""], "work": ["private-work"], "generation": ["9"]})
        start = {"route": "Detail", "work_id": "private-work", "generation": 9,
                 "load_sequence": 41, "stage": "load-start", "render_state": "loading"}
        self.assertTrue(harmony_vnc.append_detail_load_event(start))
        self.assertTrue(harmony_vnc.append_detail_load_event(dict(
            start, stage="api-result", result_category="ok", status=200, error_category="")))
        self.assertTrue(harmony_vnc.append_detail_load_event(dict(start, stage="render-state", render_state="detail-ready")))
        self.assertTrue(harmony_vnc.append_detail_load_event(dict(start, load_sequence=42)))
        self.assertTrue(harmony_vnc.append_detail_load_event(dict(
            start, load_sequence=42, stage="api-result", result_category="network_failure",
            status=-1, error_category="timeout")))
        self.assertTrue(harmony_vnc.append_detail_load_event(dict(
            start, load_sequence=42, stage="render-state", render_state="error")))
        self.assertFalse(harmony_vnc.append_detail_load_event(dict(
            start, load_sequence=41, stage="api-result", result_category="ok", status=200, error_category="")))
        events = harmony_vnc.STATE["debug_events"]
        self.assertEqual([event["load_sequence"] for event in events], [41, 41, 41, 42, 42, 42])
        self.assertEqual(events[4]["error_category"], "timeout")
        self.assertNotIn("message", events[4])
        self.assertNotIn("url", events[4])

    def test_detail_load_receiver_rejects_stale_route_generation_and_unbounded_categories(self):
        harmony_vnc.apply_state({"route": ["Detail"], "kind": [""], "work": ["private-work"], "generation": ["12"]})
        event = {"route": "Detail", "work_id": "private-work", "generation": 11,
                 "load_sequence": 7, "stage": "load-start", "render_state": "loading"}
        self.assertFalse(harmony_vnc.append_detail_load_event(event))
        event["generation"] = 12
        self.assertTrue(harmony_vnc.append_detail_load_event(event))
        self.assertFalse(harmony_vnc.append_detail_load_event(dict(
            event, stage="api-result", result_category="network_failure", status=-1,
            error_category="private error text")))
        self.assertTrue(harmony_vnc.append_detail_load_event(dict(
            event, stage="api-result", result_category="http_failure", status=404,
            error_category="not_json")))
        self.assertEqual(len(harmony_vnc.STATE["debug_events"]), 2)
        self.assertEqual(harmony_vnc.STATE["debug_events"][-1]["error_category"], "not_json")

    def test_image_payload_scope_can_arrive_before_upload_metrics(self):
        harmony_vnc.apply_state({
            "route": ["Detail"], "kind": [""], "work": ["work-private"], "generation": ["9"],
        })
        self.assertTrue(harmony_vnc.append_detail_image_payload_scope({
            "route": "Detail", "work_id": "work-private", "parent_work_id": "work-private",
            "row_id": "row-private", "generation": 9, "image_id": "738",
        }))
        self.assertEqual(harmony_vnc.STATE.get("debug_events", []), [])
        data = io.BytesIO()
        Image.new("RGBA", (2, 2), (8, 9, 10, 255)).save(data, "PNG")
        harmony_vnc.record_image_upload("738", data.getvalue())
        event = harmony_vnc.STATE["debug_events"][-1]
        self.assertEqual(event["category"], "detail-image-payload-metrics")
        self.assertEqual(event["mean_red"], 8)
        self.assertNotIn("738", json.dumps(event))
        self.assertEqual(harmony_vnc.IMAGE_SCOPES, {})
        self.assertEqual(harmony_vnc.IMAGE_METRICS, {})

    def test_malformed_image_payload_emits_only_bounded_decode_stage(self):
        harmony_vnc.apply_state({
            "route": ["Detail"], "kind": [""], "work": ["work-private"], "generation": ["9"],
        })
        harmony_vnc.record_image_upload("735", b"private malformed payload content")
        self.assertNotIn("735", harmony_vnc.IMAGES)
        self.assertTrue(harmony_vnc.append_detail_image_payload_scope({
            "route": "Detail", "work_id": "work-private", "parent_work_id": "work-private",
            "row_id": "row-private", "generation": 9, "image_id": "735",
        }))
        event = harmony_vnc.STATE["debug_events"][-1]
        self.assertEqual(event["category"], "detail-image-payload-decode-error")
        self.assertEqual(set(event), {"sequence", "category", "timestamp", "route", "work_id",
                                      "generation", "parent_work_id", "row_id"})
        self.assertNotIn("735", json.dumps(event))
        self.assertNotIn("malformed payload content", json.dumps(event))
        summary = summarize_detail_image_payload_events(
            harmony_vnc.STATE["debug_events"], sequence_after=0,
            work_id="work-private", generation=9)
        self.assertEqual(summary, {"payload_count": 0, "decode_error_count": 1, "oversized_count": 0})

    def test_oversized_payload_emits_only_bounded_enum_and_numeric_count(self):
        harmony_vnc.apply_state({
            "route": ["Detail"], "kind": [""], "work": ["work-private"], "generation": ["9"],
        })
        with patch.object(harmony_vnc, "image_payload_metrics", return_value={"decode_status": "oversized"}):
            harmony_vnc.record_image_upload("737", b"small transport fixture")
        self.assertNotIn("737", harmony_vnc.IMAGES)
        self.assertTrue(harmony_vnc.append_detail_image_payload_scope({
            "route": "Detail", "work_id": "work-private", "parent_work_id": "work-private",
            "row_id": "row-private", "generation": 9, "image_id": "737",
        }))
        event = harmony_vnc.STATE["debug_events"][-1]
        self.assertEqual(event["category"], "detail-image-payload-oversized")
        self.assertNotIn("image_id", event)
        summary = summarize_detail_image_payload_events(
            harmony_vnc.STATE["debug_events"], sequence_after=0,
            work_id="work-private", generation=9)
        self.assertEqual(summary, {"payload_count": 0, "decode_error_count": 1, "oversized_count": 1})

    def test_image_payload_scope_rejects_stale_generation_and_non_numeric_key(self):
        harmony_vnc.apply_state({
            "route": ["Detail"], "kind": [""], "work": ["work-private"], "generation": ["9"],
        })
        body = {
            "route": "Detail", "work_id": "work-private", "parent_work_id": "work-private",
            "row_id": "row-private", "generation": 8, "image_id": "736",
        }
        self.assertFalse(harmony_vnc.append_detail_image_payload_scope(body))
        self.assertFalse(harmony_vnc.append_detail_image_payload_scope(dict(body, generation=9, image_id="/img/736")))
        self.assertEqual(harmony_vnc.STATE.get("debug_events", []), [])

    def test_invalid_image_key_is_rejected_before_payload_decode_or_cache(self):
        self.assertTrue(harmony_vnc.valid_numeric_image_key("987654321"))
        self.assertFalse(harmony_vnc.valid_numeric_image_key(""))
        self.assertFalse(harmony_vnc.valid_numeric_image_key("１２３"))
        self.assertFalse(harmony_vnc.valid_numeric_image_key("12345678901234567"))
        bridge_source = (HERE / "harmony_vnc.py").read_text(encoding="utf-8")
        imgput = bridge_source.split('if url.path == "/imgput":', 1)[1].split('body = json.loads', 1)[0]
        self.assertLess(imgput.index("if not valid_numeric_image_key(image_id)"),
                        imgput.index("self.rfile.read(content_length)"))
        with patch.object(harmony_vnc, "image_payload_metrics") as decode:
            status = harmony_vnc.record_image_upload("/img/737", b"invalid key fixture")
        self.assertEqual(status, "invalid-key")
        decode.assert_not_called()
        self.assertNotIn("/img/737", harmony_vnc.IMAGES)

    def test_fresh_row_completion_can_arrive_before_bridge_route_report(self):
        harmony_vnc.apply_state({
            "route": ["Home"], "kind": [""], "work": [""], "generation": ["4"],
        })
        cursor = harmony_vnc.STATE.get("debug_sequence", 0)
        event_body = {
            "route": "Detail", "work_id": "work-a", "parent_work_id": "work-a",
            "row_id": "row-a", "generation": 5,
        }
        self.assertTrue(harmony_vnc.append_row_image_event(event_body))
        event = harmony_vnc.STATE["debug_events"][-1]
        self.assertEqual(event["category"], "detail-row-image-complete")
        self.assertGreater(event["sequence"], cursor)
        self.assertEqual(event["route"], "Detail")
        self.assertEqual(event["work_id"], "work-a")
        self.assertEqual(event["parent_work_id"], "work-a")
        self.assertEqual(event["row_id"], "row-a")
        self.assertEqual(event["generation"], 5)

        harmony_vnc.apply_state({
            "route": ["Detail"], "kind": [""], "work": ["work-a"], "generation": ["5"],
        })
        confirmed = harmony_vnc.STATE
        self.assertTrue(any(
            event["sequence"] > cursor and event["route"] == confirmed["route"]
            and event["work_id"] == confirmed["work_id"]
            and event["generation"] == confirmed["route_generation"]
            for event in confirmed["debug_events"]
        ))

    def test_stale_generation_or_conflicting_work_is_rejected(self):
        harmony_vnc.apply_state({
            "route": ["Detail"], "kind": [""], "work": ["work-a"], "generation": ["7"],
        })
        self.assertFalse(harmony_vnc.append_row_image_event({
            "route": "Detail", "work_id": "work-a", "parent_work_id": "work-a",
            "row_id": "row-a", "generation": 6,
        }))
        self.assertFalse(harmony_vnc.append_row_image_event({
            "route": "Detail", "work_id": "work-b", "parent_work_id": "work-b",
            "row_id": "row-a", "generation": 7,
        }))
        self.assertFalse(harmony_vnc.append_row_image_event({
            "route": "Detail", "work_id": "work-a", "parent_work_id": "work-a",
            "row_id": "", "generation": 7,
        }))

    def test_detail_image_stages_require_valid_scope_and_allowlisted_stage(self):
        harmony_vnc.apply_state({
            "route": ["Detail"], "kind": [""], "work": ["work-a"], "generation": ["7"],
        })
        body = {
            "route": "Detail", "work_id": "work-a", "parent_work_id": "work-a",
            "row_id": "row-a", "generation": 7, "stage": "fetch-error",
        }
        self.assertTrue(harmony_vnc.append_detail_image_stage(body))
        event = harmony_vnc.STATE["debug_events"][-1]
        self.assertEqual(event["category"], "detail-row-image-fetch-error")
        self.assertIsInstance(event["timestamp"], float)
        self.assertTrue(harmony_vnc.append_detail_image_stage(dict(body, stage="image-source")))
        self.assertTrue(harmony_vnc.append_detail_image_stage(dict(body, stage="image-area-positive")))
        self.assertTrue(harmony_vnc.append_detail_image_stage(dict(body, stage="image-area-zero")))
        for stage in (
            "row-match-found", "row-match-missing", "poster-artwork-prop-undefined",
            "poster-artwork-prop-present", "poster-render-artwork-undefined",
            "poster-render-artwork-present", "artwork-store-present", "artwork-store-absent", "artwork-store-updated",
            "visible-item-artwork-state-absent", "visible-item-artwork-state-present",
        ):
            self.assertTrue(harmony_vnc.append_detail_image_stage(dict(body, stage=stage)), stage)
        self.assertNotIn("width", harmony_vnc.STATE["debug_events"][-1])
        self.assertNotIn("height", harmony_vnc.STATE["debug_events"][-1])
        self.assertFalse(harmony_vnc.append_detail_image_stage(dict(body, stage="bad", row_id="row-b")))
        self.assertFalse(harmony_vnc.append_detail_image_stage(dict(body, generation=6)))
        self.assertFalse(harmony_vnc.append_detail_image_stage(dict(body, work_id="work-b", parent_work_id="work-b")))
        self.assertFalse(harmony_vnc.append_detail_image_stage(dict(body, route="Home")))

    def test_layout_stages_require_exact_detail_scope_and_numeric_measurements(self):
        harmony_vnc.apply_state({
            "route": ["Detail"], "kind": [""], "work": ["work-a"], "generation": ["7"],
        })
        body = {
            "route": "Detail", "work_id": "work-a", "generation": 7,
            "stage": "rail-list-area", "value": -1, "width": 1280, "height": 420,
        }
        self.assertTrue(harmony_vnc.append_detail_layout_stage(body))
        event = harmony_vnc.STATE["debug_events"][-1]
        self.assertEqual(event["category"], "detail-layout-rail-list-area")
        self.assertEqual((event["width"], event["height"], event["area"]), (1280, 420, 537600))
        self.assertNotIn("row_id", event)
        self.assertTrue(harmony_vnc.append_detail_layout_stage(dict(body, stage="rail-items-prop-update-count", value=5)))
        self.assertTrue(harmony_vnc.append_detail_layout_stage(dict(body, stage="rail-items-prop-update-artwork-count", value=3)))
        newer = dict(body, generation=8, stage="rail-items-count", value=5, width=-1, height=-1)
        self.assertTrue(harmony_vnc.append_detail_layout_stage(newer))
        newer_event = harmony_vnc.STATE["debug_events"][-1]
        self.assertEqual(newer_event["route"], "Detail")
        self.assertEqual(newer_event["work_id"], "work-a")
        self.assertEqual(newer_event["generation"], 8)
        self.assertEqual(newer_event["value"], 5)
        self.assertFalse(harmony_vnc.append_detail_layout_stage(dict(body, generation=6)))
        self.assertFalse(harmony_vnc.append_detail_layout_stage(dict(body, work_id="work-b")))
        self.assertFalse(harmony_vnc.append_detail_layout_stage(dict(body, stage="private-title")))
        self.assertFalse(harmony_vnc.append_detail_layout_stage(dict(body, width="1280")))
        self.assertFalse(harmony_vnc.append_detail_layout_stage(dict(body, height=float("nan"))))
        self.assertFalse(harmony_vnc.append_detail_layout_stage(dict(body, width=float("inf"))))
        self.assertFalse(harmony_vnc.append_detail_layout_stage(dict(body, width=1000001)))
        self.assertFalse(harmony_vnc.append_detail_layout_stage(dict(body, height=-2)))
        self.assertFalse(harmony_vnc.append_detail_layout_stage(dict(body, height=10**1000)))
        self.assertFalse(harmony_vnc.append_detail_layout_stage(dict(
            body, stage="series-target-season-centre-delta-vp", value=-1000001, width=-1, height=-1,
        )))
        target_visibility = {
            "route": "Detail", "work_id": "work-a", "generation": 7,
            "stage": "series-target-card-visibility", "visible": 1,
            "intersection_width_vp": 540, "intersection_height_vp": 330,
            "page_offset_vp": -229, "rail_offset_vp": 0, "offsets_fresh": 1,
            "row_id": "private-row", "url": "https://private.example",
        }
        self.assertTrue(harmony_vnc.append_detail_layout_stage(target_visibility))
        target_event = harmony_vnc.STATE["debug_events"][-1]
        self.assertEqual(target_event["category"], "detail-layout-series-target-card-visibility")
        self.assertEqual(target_event["page_offset_vp"], -229)
        self.assertNotIn("row_id", target_event)
        self.assertNotIn("url", target_event)
        self.assertFalse(harmony_vnc.append_detail_layout_stage(dict(target_visibility, offsets_fresh=2)))
        self.assertFalse(harmony_vnc.append_detail_layout_stage({
            key: value for key, value in target_visibility.items() if key != "rail_offset_vp"
        }))
        self.assertFalse(harmony_vnc.append_detail_layout_stage(dict(target_visibility, rail_offset_vp=None)))
        self.assertFalse(harmony_vnc.append_detail_layout_stage(dict(target_visibility, intersection_width_vp=float("nan"))))
        self.assertFalse(harmony_vnc.append_detail_layout_stage(dict(target_visibility, page_offset_vp=float("inf"))))
        area_sample = {
            "route": "Detail", "work_id": "work-a", "generation": 7,
            "stage": "series-target-area-sample", "present": 1,
            "width_vp": 268, "height_vp": 151, "page_offset_vp": -229, "rail_offset_vp": 0,
            "sampled_at_ms": 1791910000123,
            "row_id": "private-row", "title": "private title", "url": "https://private.example",
        }
        self.assertTrue(harmony_vnc.append_detail_layout_stage(area_sample))
        area_event = harmony_vnc.STATE["debug_events"][-1]
        self.assertEqual(area_event["category"], "detail-layout-series-target-area-sample")
        self.assertEqual((area_event["present"], area_event["width_vp"], area_event["height_vp"],
                          area_event["page_offset_vp"], area_event["rail_offset_vp"],
                          area_event["sampled_at_ms"]), (1, 268, 151, -229, 0, 1791910000123))
        self.assertNotIn("row_id", area_event)
        self.assertNotIn("title", area_event)
        self.assertNotIn("url", area_event)
        invalid_area_sample = dict(area_sample, present=0)
        self.assertTrue(harmony_vnc.append_detail_layout_stage(invalid_area_sample))
        self.assertFalse(harmony_vnc.append_detail_layout_stage(dict(area_sample, width_vp=0)))
        self.assertFalse(harmony_vnc.append_detail_layout_stage(dict(area_sample, rail_offset_vp=float("nan"))))
        self.assertFalse(harmony_vnc.append_detail_layout_stage(dict(area_sample, page_offset_vp=None)))
        area_summary = summarize_detail_layout_events(
            [area_event], sequence_after=0, work_id="work-a", generation=7, started_at=0)
        self.assertEqual(area_summary["series-target-area-sample"]["present"], {"min": 1, "max": 1})
        self.assertEqual(area_summary["series-target-area-sample"]["width_vp"], {"min": 268, "max": 268})
        self.assertEqual(area_summary["series-target-area-sample"]["sampled_at_ms"],
                         {"min": 1791910000123, "max": 1791910000123})
        self.assertNotIn("private-row", json.dumps(area_summary))
        self.assertNotIn("private title", json.dumps(area_summary))
        self.assertNotIn("https://", json.dumps(area_summary))
        generation_scope = {
            "route": "Detail", "work_id": "work-a", "generation": 7,
            "stage": "detail-preview-generation-scope", "captured_generation": 6,
            "live_generation": 7, "scope_matches": 0,
            "title": "private title", "url": "https://private.example",
        }
        self.assertTrue(harmony_vnc.append_detail_layout_stage(generation_scope))
        generation_event = harmony_vnc.STATE["debug_events"][-1]
        self.assertEqual(generation_event["captured_generation"], 6)
        self.assertEqual(generation_event["live_generation"], 7)
        self.assertEqual(generation_event["scope_matches"], 0)
        self.assertNotIn("title", generation_event)
        self.assertNotIn("url", generation_event)
        self.assertFalse(harmony_vnc.append_detail_layout_stage(dict(generation_scope, scope_matches=1)))
        generation_summary = summarize_detail_layout_events(
            [generation_event], sequence_after=0, work_id="work-a", generation=7, started_at=0)
        self.assertEqual(generation_summary["detail-preview-generation-scope"]["captured_generation"],
                         {"min": 6, "max": 6})
        self.assertEqual(generation_summary["detail-preview-generation-scope"]["scope_matches"],
                         {"min": 0, "max": 0})
        target_summary = summarize_detail_layout_events(
            [target_event], sequence_after=0, work_id="work-a", generation=7, started_at=0)
        self.assertEqual(target_summary["series-target-card-visibility"]["visible"]["last_value"], 1)
        self.assertEqual(target_summary["series-target-card-visibility"]["page_offset_vp"]["last_value"], -229)
        self.assertNotIn("work-a", json.dumps(target_summary))
        self.assertNotIn("private-row", json.dumps(target_summary))
        self.assertTrue(harmony_vnc.append_detail_layout_stage(dict(body, stage="series-focus-request-issued", value=0)))
        self.assertTrue(harmony_vnc.append_detail_layout_stage(dict(body, stage="series-focus-request-result", value=1)))
        self.assertFalse(harmony_vnc.append_detail_layout_stage(dict(body, stage="series-focus-request-result", value=2)))

    def test_series_layout_emitters_reach_the_receiver_and_final_summary(self):
        detail_source = (HERE.parents[1] / "clients/harmony/entry/src/main/ets/pages/Detail.ets").read_text(encoding="utf-8")
        transformed = patch_state.detail(detail_source)
        load_detail_scope = transformed.split("private async loadDetail(): Promise<void> {", 1)[1].split(
            "\n  private ", 1)[0]
        self.assertLess(load_detail_scope.index("setPreviewRouteContext('Detail', '', this.workId)"),
                        load_detail_scope.index("this.previewScopeGeneration = currentPreviewRouteGeneration()"))
        self.assertLess(load_detail_scope.index("this.previewScopeGeneration = currentPreviewRouteGeneration()"),
                        load_detail_scope.index("this.previewCardAreaRouteGenerations = new Map()"))
        self.assertIn("this.previewScopeGeneration = currentPreviewRouteGeneration()", load_detail_scope)
        self.assertNotIn("reportDetailPreviewGenerationScope", load_detail_scope)
        self.assertIn("reportDetailEpisodeTargetForScope('Detail', this.workId, result.value.target.episode_id, this.previewScopeGeneration)", transformed)
        preview_state_source = (HERE / "overlay/src/main/ets/util/PreviewState.ets").read_text(encoding="utf-8")
        route_context = preview_state_source.split("export function setPreviewRouteContext(", 1)[1].split(
            "export function reportPreviewRoute(", 1)[0]
        self.assertIn("PREVIEW_ROUTE !== route || PREVIEW_WORK_ID !== nextWorkId", route_context)
        self.assertIn("PREVIEW_ROUTE_GENERATION += 1", route_context)
        area_callback_scope = transformed.split("private seriesRailItemAreaReporter(", 1)[1].split(
            "private seriesCardArtworkAreaReporter(", 1)[0]
        self.assertIn("const livePreviewGeneration = currentPreviewRouteGeneration()", area_callback_scope)
        scope_check = "reportDetailPreviewGenerationScope(workId, this.previewScopeGeneration, livePreviewGeneration)"
        self.assertIn(scope_check, area_callback_scope)
        self.assertLess(area_callback_scope.index(scope_check),
                        area_callback_scope.index("this.seriesCardAreaChanged("))
        self.assertNotIn("this.previewScopeGeneration = currentPreviewRouteGeneration()", area_callback_scope)
        stages = (
            "series-focus-request-count",
            "series-focused-row-is-target",
            "series-target-season-row-area",
            "series-target-season-centre-delta-vp",
            "series-target-area-sample",
            "detail-preview-generation-scope",
            "resume-plan-loaded",
            "target-present",
            "target-in-any-rail",
            "target-card-mounted",
            "target-season-scroll-requested",
            "target-episode-scroll-requested",
            "target-episode-initial-index-watch",
            "target-episode-initial-index-watch-hook-ran",
            "target-episode-list-appeared",
            "target-episode-list-appeared-hook-ran",
            "target-episode-initial-index-applied",
            "target-episode-live-item-count-at-callback",
            "target-episode-live-prop-target-found",
            "target-episode-live-prop-target-index",
            "target-episode-live-prop-target-at-callback-found",
            "target-episode-live-prop-target-at-callback-index",
            "target-episode-positioned-callback",
            "target-episode-callback-captured-item-count",
            "target-episode-callback-captured-target-found",
            "target-episode-callback-captured-target-index",
            "target-episode-callback-live-rail-found",
            "target-episode-callback-live-item-count",
            "target-episode-callback-live-target-found",
            "target-episode-callback-live-target-index",
            "focus-pending",
            "focus-suppressed",
            "focus-request-count",
        )
        rail_stages = {"target-episode-initial-index-watch", "target-episode-initial-index-watch-hook-ran",
                       "target-episode-list-appeared", "target-episode-list-appeared-hook-ran",
                       "target-episode-initial-index-applied", "target-episode-live-item-count-at-callback",
                       "target-episode-live-prop-target-found", "target-episode-live-prop-target-index",
                       "target-episode-live-prop-target-at-callback-found",
                       "target-episode-live-prop-target-at-callback-index", "series-target-area-sample",
                       "detail-preview-generation-scope"}
        for stage in stages:
            if stage in rail_stages:
                continue
            self.assertIn("'" + stage + "'", transformed)
        rail_source = (HERE.parents[1] / "clients/harmony/entry/src/main/ets/design/components/MediaRail.ets").read_text(encoding="utf-8")
        transformed_rail = patch_rail.transform(rail_source)
        for stage in ("target-episode-initial-index-watch", "target-episode-initial-index-watch-hook-ran",
                      "target-episode-list-appeared", "target-episode-list-appeared-hook-ran",
                      "target-episode-initial-index-applied", "target-episode-live-item-count-at-callback",
                      "target-episode-live-prop-target", "target-episode-live-prop-target-at-callback"):
            self.assertIn("'" + stage + "'", transformed_rail)

        harmony_vnc.apply_state({
            "route": ["Detail"], "kind": [""], "work": ["work-a"], "generation": ["7"],
        })
        events = (
            ("series-focus-request-count", 1, -1, -1),
            ("series-focused-row-is-target", 1, -1, -1),
            ("series-target-season-row-area", 1, 900, 340),
            ("series-target-season-centre-delta-vp", -18, 900, 340),
            ("resume-plan-loaded", 1, -1, -1),
            ("target-present", 1, -1, -1),
            ("target-in-any-rail", 1, -1, -1),
            ("target-card-mounted", 1, -1, -1),
            ("target-season-scroll-requested", 1, -1, -1),
            ("target-episode-scroll-requested", 1, -1, -1),
            ("target-episode-initial-index-watch", 4, -1, -1),
            ("target-episode-initial-index-watch-hook-ran", 1, -1, -1),
            ("target-episode-list-appeared", 4, -1, -1),
            ("target-episode-list-appeared-hook-ran", 1, -1, -1),
            ("target-episode-initial-index-applied", 4, -1, -1),
            ("target-episode-live-item-count-at-callback", 12, -1, -1),
            ("target-episode-live-prop-target-found", 1, -1, -1),
            ("target-episode-live-prop-target-index", 4, -1, -1),
            ("target-episode-live-prop-target-at-callback-found", 1, -1, -1),
            ("target-episode-live-prop-target-at-callback-index", 4, -1, -1),
            ("target-episode-positioned-callback", 1, -1, -1),
            ("target-episode-callback-captured-item-count", 12, -1, -1),
            ("target-episode-callback-captured-target-found", 1, -1, -1),
            ("target-episode-callback-captured-target-index", 4, -1, -1),
            ("target-episode-callback-live-rail-found", 1, -1, -1),
            ("target-episode-callback-live-item-count", 12, -1, -1),
            ("target-episode-callback-live-target-found", 1, -1, -1),
            ("target-episode-callback-live-target-index", 4, -1, -1),
            ("focus-pending", 1, -1, -1),
            ("focus-suppressed", 0, -1, -1),
            ("focus-request-count", 1, -1, -1),
            ("series-focused-row-is-target", 0, -1, -1),
        )
        for stage, value, width, height in events:
            body = {
                "route": "Detail", "work_id": "work-a", "generation": 7, "stage": stage,
                "value": value, "width": width, "height": height,
            }
            self.assertTrue(harmony_vnc.append_detail_layout_stage(body), stage)
        self.assertTrue(harmony_vnc.append_detail_layout_stage({
            "route": "Detail", "work_id": "work-a", "generation": 7,
            "stage": "series-target-area-sample", "present": 1,
            "width_vp": 268, "height_vp": 151, "page_offset_vp": -229, "rail_offset_vp": 0,
            "sampled_at_ms": 1791910000123,
        }))
        self.assertTrue(harmony_vnc.append_detail_layout_stage({
            "route": "Detail", "work_id": "work-a", "generation": 7,
            "stage": "detail-preview-generation-scope", "captured_generation": 7,
            "live_generation": 7, "scope_matches": 1,
        }))

        summary = summarize_detail_layout_events(
            harmony_vnc.STATE["debug_events"], sequence_after=0, work_id="work-a", generation=7, started_at=0,
        )
        self.assertEqual(set(summary), set(stages))
        self.assertEqual(summary["series-focus-request-count"]["value"], {"min": 1, "max": 1})
        self.assertEqual(summary["focus-request-count"]["value"], {"min": 1, "max": 1})
        for stage in ("resume-plan-loaded", "target-present", "target-in-any-rail", "target-card-mounted",
                      "target-season-scroll-requested", "target-episode-scroll-requested", "focus-pending", "focus-suppressed"):
            self.assertIn(stage, summary)
        self.assertEqual(summary["series-focused-row-is-target"]["last_value"], 0)
        self.assertEqual(summary["series-focused-row-is-target"]["count"], 2)
        self.assertEqual(summary["series-target-season-row-area"]["width"], {"min": 900, "max": 900})
        self.assertEqual(summary["series-target-season-centre-delta-vp"]["value"], {"min": -18, "max": -18})
        self.assertNotIn("work-a", json.dumps(summary))

        for stage in ("target-episode-positioned-callback", "target-episode-callback-captured-item-count",
                      "target-episode-callback-captured-target-found", "target-episode-callback-captured-target-index",
                      "target-episode-callback-live-rail-found", "target-episode-callback-live-item-count",
                      "target-episode-callback-live-target-found", "target-episode-callback-live-target-index"):
            self.assertIn("'" + stage + "'", transformed)

    def test_area_geometry_codes_and_sanitised_numeric_summary(self):
        harmony_vnc.apply_state({
            "route": ["Detail"], "kind": [""], "work": ["work-private"], "generation": ["9"],
        })
        body = {
            "route": "Detail", "work_id": "work-private", "generation": 9,
            "stage": "detail-row-area-geometry",
            "x": 0, "y": None, "global_x": 12.5, "global_y": -4,
            "width": 268, "height": 151,
            "x_type_code": 1, "y_type_code": 0, "global_x_type_code": 1, "global_y_type_code": 1,
            "width_type_code": 1, "height_type_code": 1,
            "x_unit_code": 1, "y_unit_code": 0, "global_x_unit_code": 1, "global_y_unit_code": 1,
            "width_unit_code": 1, "height_unit_code": 1,
            "row_id": "private-row", "title": "private title", "url": "https://private.example",
        }
        self.assertTrue(harmony_vnc.append_detail_layout_stage(body))
        event = harmony_vnc.STATE["debug_events"][-1]
        self.assertEqual(event["x"], 0)
        self.assertNotIn("y", event)
        self.assertEqual(event["y_type_code"], 0)
        self.assertEqual(event["global_y"], -4)
        for forbidden in ("row_id", "title", "url"):
            self.assertNotIn(forbidden, event)

        summary = summarize_detail_layout_events(
            [event], sequence_after=0, work_id="work-private", generation=9, started_at=0,
        )
        geometry = summary["detail-row-area-geometry"]
        self.assertEqual(geometry["x"], {"min": 0, "max": 0})
        self.assertNotIn("y", geometry)
        self.assertEqual(geometry["y_type_code"], {"min": 0, "max": 0})
        self.assertEqual(geometry["global_y"], {"min": -4, "max": -4})
        self.assertEqual(geometry["width"], {"min": 268, "max": 268})
        self.assertNotIn("work-private", json.dumps(summary))
        self.assertNotIn("private-row", json.dumps(summary))
        self.assertNotIn("private title", json.dumps(summary))
        self.assertNotIn("https://", json.dumps(summary))

        self.assertFalse(harmony_vnc.append_detail_layout_stage(dict(body, x_type_code=True)))
        self.assertFalse(harmony_vnc.append_detail_layout_stage(dict(body, height_unit_code=9)))
        self.assertFalse(harmony_vnc.append_detail_layout_stage(dict(body, global_x=float("nan"))))

    def test_episode_geometry_and_row_completion_reach_dynamic_capture_acceptance(self):
        detail_source = (HERE.parents[1] / "clients/harmony/entry/src/main/ets/pages/Detail.ets").read_text(encoding="utf-8")
        poster_source = (HERE.parents[1] / "clients/harmony/entry/src/main/ets/design/components/PosterCard.ets").read_text(encoding="utf-8")
        transformed = patch_state.detail(detail_source)
        transformed_poster = patch_state.card(poster_source)
        self.assertIn("reportDetailEpisodeTargetForScope", transformed)
        self.assertIn("reportDetailEpisodeCardContainerAreaForScope('Detail', workId, episodeId, this.previewScopeGeneration", transformed)
        self.assertNotIn("reportDetailEpisodeCardContainerAreaForScope('Detail', workId, episodeId, generation", transformed)
        self.assertIn("rect.left, rect.top, rect.width, rect.height, this.getUIContext().vp2px(1));", transformed)
        self.assertIn("this.measuredSeriesAreaRects.set(measurementId, rect);\n    this.measuredSeriesCardAreas.set(measurementId, {\n      workId: workId,", transformed)
        self.assertIn("capturedAtMs: Date.now(),\n    });\n    this.previewCardAreaRouteGenerations.set(measurementId, this.previewScopeGeneration);\n    reportDetailEpisodeCardContainerAreaForScope", transformed)
        self.assertNotIn("const cardRect = this.componentRect(measurementId)", transformed)
        image_area_hook = transformed_poster.split("Image(this.artwork)", 1)[1].split(".onComplete", 1)[0]
        self.assertIn("reportDetailEpisodeCardAreaForMeasurement(this.getUIContext()", image_area_hook)
        self.assertIn("this.previewRailId, this.previewOccurrence, this.measurementId", image_area_hook)
        self.assertNotIn("area.globalPosition", image_area_hook)
        preview_state = (HERE / "overlay/src/main/ets/util/PreviewState.ets").read_text(encoding="utf-8")
        self.assertIn("seriesDetailMeasurementId('card', workId, generation", preview_state)
        self.assertIn("episodeFocusRectForComponent(uiContext, componentId)", preview_state)
        area_reporter = preview_state.split("export function reportDetailEpisodeCardAreaForMeasurement(", 1)[1].split(
            "export function reportDetailRowImageComplete(", 1)[0]
        self.assertIn("componentId !== seriesDetailMeasurementId('card', workId, generation", area_reporter)
        self.assertIn("const rect = episodeFocusRectForComponent(uiContext, componentId);", area_reporter)
        self.assertIn("if (rect === null)", area_reporter)
        self.assertIn("rect.left, rect.top, rect.width, rect.height", area_reporter)
        self.assertIn("rect.left, rect.top, rect.width, rect.height, uiContext.vp2px(1)", area_reporter)
        scoped_art_reporter = preview_state.split("export function reportDetailEpisodeCardAreaForScope(", 1)[1].split(
            "export function reportDetailEpisodeCardAreaForMeasurement(", 1)[0]
        self.assertIn("heightVp: number,\n                                                     densityPixels: number", scoped_art_reporter)
        self.assertIn("if (!Number.isFinite(densityPixels) || densityPixels <= 0)", scoped_art_reporter)
        self.assertNotIn("display.getDefaultDisplaySync()", scoped_art_reporter)
        container_reporter = preview_state.split(
            "export function reportDetailEpisodeCardContainerAreaForScope(", 1)[1].split(
            "export function reportDetailEpisodeCardAreaForScope(", 1)[0]
        for field in ("sender_route_ok", "sender_work_present", "sender_work_matches",
                      "sender_generation_matches", "sender_rect_finite", "sender_rect_positive",
                      "sender_density_valid"):
            self.assertIn(field + ":", container_reporter)
        self.assertIn("stage: 'episode-card-container-report'", container_reporter)
        self.assertIn("heightVp: number, densityPixels: number", container_reporter)
        self.assertIn("const densityValid = Number.isFinite(densityPixels) && densityPixels > 0", container_reporter)
        self.assertIn("density: densityPixels", container_reporter)
        self.assertNotIn("display.getDefaultDisplaySync()", container_reporter)
        self.assertIn("previewPost('/layout-stage', JSON.stringify(diagnostic))", container_reporter)
        self.assertIn("previewPost('/episode-card-container-area'", container_reporter)
        self.assertIn("if (!routeOk || !workPresent || !rowId.length || !workMatches || !generationMatches ||", container_reporter)
        measurement_helper = (HERE.parents[1] / "clients/harmony/entry/src/main/ets/design/ComponentMeasurement.ets").read_text(encoding="utf-8")
        self.assertIn("getComponentUtils().getRectangleById(componentId)", measurement_helper)
        self.assertIn("episodeFocusRectFromWindowPixels(component.windowOffset.x, component.windowOffset.y", measurement_helper)
        focus_detail = detail_source.split("private seriesCardAreaChanged(", 1)[1].split(
            "private seriesRailItemAreaReporter(", 1)[0]
        target_focus = detail_source.split("private tryInitialEpisodeFocus(", 1)[1].split(
            "private railIdForEpisode(", 1)[0]
        self.assertIn("this.seriesMeasurementId('card', workId, generation, railId, episodeId, occurrence)", focus_detail)
        self.assertIn("generation: number, area: Area, railOffset: number", focus_detail)
        self.assertIn("rail.items[occurrence].id !== episodeId", focus_detail)
        self.assertIn("!Number.isFinite(railOffset)", focus_detail)
        self.assertIn("const rect = detailFocusRectForArea(area)", focus_detail)
        for captured_value in ("workId: workId", "generation: generation", "railId: railId",
                               "episodeId: episodeId", "occurrence: occurrence", "pageOffset: pageOffset",
                               "railOffset: railOffset", "capturedAtMs: Date.now()"):
            self.assertIn(captured_value, focus_detail)
        self.assertIn("this.measuredSeriesAreaRects.set(measurementId, rect)", focus_detail)
        self.assertIn("this.seriesMeasurementId('card', workId, generation, targetRailId, episodeId, occurrence)", target_focus)
        self.assertIn("this.measuredSeriesAreaRects.get(measurementId)", target_focus)
        self.assertIn("this.measuredSeriesAreaRects.get(\n      this.seriesMeasurementId('rail'", target_focus)
        self.assertIn("this.measuredSeriesAreaRects.get(this.seriesMeasurementId('page'", target_focus)
        self.assertIn("seriesEpisodeAreaSampleMatchesTarget(", target_focus)
        self.assertIn("hasPositiveEpisodeAreaSample(", target_focus)
        self.assertIn("const mounted = appeared || hasPositiveEpisodeAreaSample(", target_focus)
        self.assertNotIn("episodeFocusRectForComponent", detail_source)
        for callback in ("seriesRailAreaChanged", "seriesPageAreaChanged"):
            callback_source = detail_source.split("private " + callback + "(", 1)[1].split("\n  private ", 1)[0]
            self.assertIn("area: Area", callback_source)
            self.assertIn("detailFocusRectForArea(area)", callback_source)
        self.assertNotIn("reportDetailEpisodeCardAreaForScope", transformed_poster.split(".width(this.cardWidth)", 1)[1].split(".clip(true)", 1)[0])

        rail_source = (HERE.parents[1] / "clients/harmony/entry/src/main/ets/design/components/MediaRail.ets").read_text(encoding="utf-8")
        list_item_area = rail_source.split("ListItem() {", 1)[1].split("          },", 1)[0]
        self.assertIn("this.onItemAreaChange(item.id, index, area, this.listScroller.currentOffset().xOffset)", list_item_area)
        self.assertIn("onItemAreaChange: this.seriesRailItemAreaReporter(", detail_source)
        self.assertIn("rail.id, this.workId, this.seriesFocusGeneration", detail_source)
        self.assertNotIn("this.listOffsetForRail(railId)", focus_detail)
        self.assertIn("reportDetailSeriesTargetAreaSampleForScope('Detail', workId, previewAreaRouteGeneration", transformed)
        sample_report = transformed.split("reportDetailSeriesTargetAreaSampleForScope(", 1)[0].split(
            "private tryInitialEpisodeFocus(", 1)[1]
        self.assertIn("const cardMeasurement = this.measuredSeriesCardAreas.get(measurementId)", sample_report)
        self.assertIn("if (cardMeasurement !== undefined)", sample_report)
        self.assertIn("const areaFresh = cardMeasurement !== null", sample_report)
        self.assertIn("seriesEpisodeAreaSampleMatchesTarget(cardMeasurement", sample_report)
        self.assertIn("cardMeasurement.pageOffset", sample_report)
        self.assertIn("cardMeasurement.railOffset", sample_report)
        self.assertIn("previewCardAreaRouteGenerations.set(measurementId, this.previewScopeGeneration)", transformed)
        self.assertIn("const previewAreaRouteGeneration = this.previewCardAreaRouteGenerations.get(measurementId)", sample_report)
        self.assertIn("reportDetailPreviewGenerationScope(workId, previewAreaRouteGeneration", sample_report)
        sample_call = transformed.split("reportDetailSeriesTargetAreaSampleForScope(", 1)[1].split(");", 1)[0]
        self.assertIn("cardMeasurement.pageOffset", sample_call)
        self.assertIn("cardMeasurement.railOffset", sample_call)
        self.assertIn("cardMeasurement.capturedAtMs", sample_call)
        self.assertNotIn("pageOffset, currentRailOffset", sample_call)
        self.assertNotIn("reportDetailSeriesTargetAreaSampleForScope", transformed.split(
            "private seriesCardAreaChanged(", 1)[1].split("private seriesRailItemAreaReporter(", 1)[0])
        preview_state = (HERE / "overlay/src/main/ets/util/PreviewState.ets").read_text(encoding="utf-8")
        area_reporter = preview_state.split("export function reportDetailSeriesTargetAreaSampleForScope(", 1)[1].split(
            "export function reportDetailEpisodeCardContainerAreaForScope(", 1)[0]
        self.assertIn("stage: 'series-target-area-sample'", area_reporter)
        self.assertIn("width_vp: widthVp, height_vp: heightVp", area_reporter)
        self.assertNotIn("row_id", area_reporter)
        self.assertNotIn("title", area_reporter)
        self.assertIn("interface PreviewSeriesTargetAreaSampleBody", preview_state)
        self.assertIn("const body: PreviewSeriesTargetAreaSampleBody", area_reporter)
        self.assertIn("sampled_at_ms: sampledAtMs", area_reporter)
        self.assertNotIn("const body: Object = present === 1", area_reporter)
        generation_reporter = preview_state.split("export function reportDetailPreviewGenerationScope(", 1)[1].split(
            "export function reportDetailEpisodeCardContainerAreaForScope(", 1)[0]
        self.assertIn("captured_generation: capturedGeneration", generation_reporter)
        self.assertIn("live_generation: liveGeneration", generation_reporter)
        self.assertIn("const matches = capturedGeneration === liveGeneration ? 1 : 0", generation_reporter)
        self.assertIn("return matches === 1", generation_reporter)
        self.assertIn("workId !== PREVIEW_WORK_ID", generation_reporter)
        self.assertNotIn("row_id", generation_reporter)
        self.assertNotIn("title", generation_reporter)

        harmony_vnc.apply_state({
            "route": ["Detail"], "kind": [""], "work": ["work-private"], "generation": ["7"],
        })
        target = {
            "route": "Detail", "work_id": "work-private", "parent_work_id": "work-private",
            "row_id": "episode-target", "generation": 7,
        }
        self.assertTrue(harmony_vnc.append_detail_episode_target(target))
        rows = (("episode-target", 60, 213), ("episode-b", 210, 213),
                ("episode-c", 60, 358), ("episode-d", 210, 358))
        frame = Image.new("RGB", (1920, 1080), (0, 0, 0))
        from PIL import ImageDraw
        draw = ImageDraw.Draw(frame)
        for row_id, x_vp, y_vp in rows:
            area = {
                "route": "Detail", "work_id": "work-private", "parent_work_id": "work-private",
                "row_id": row_id, "generation": 7, "x_vp": x_vp, "y_vp": y_vp,
                "width_vp": 134, "height_vp": 75.5, "density": 2,
            }
            container_area = {**area, "height_vp": 95}
            self.assertTrue(harmony_vnc.append_detail_episode_card_container_area(container_area), row_id)
            self.assertTrue(harmony_vnc.append_detail_episode_card_area(area), row_id)
            x = x_vp * 2
            y = y_vp * 2
            for column in range(x, x + 268, 2):
                draw.line((column, y, column, y + 150), fill=(42, 58, 74) if column % 4 else (160, 136, 112))
            for stage in ("image-area-positive", "on-complete"):
                self.assertTrue(harmony_vnc.append_detail_image_stage({**target, "row_id": row_id, "stage": stage}), stage)

        self.assertFalse(harmony_vnc.append_detail_episode_card_area({
            **target, "generation": 6, "x_vp": 60, "y_vp": 213,
            "width_vp": 134, "height_vp": 75.5, "density": 2,
        }))
        self.assertFalse(harmony_vnc.append_detail_episode_card_area({
            **target, "x_vp": 60, "y_vp": 213, "width_vp": 0, "height_vp": 75, "density": 2,
        }))
        events = harmony_vnc.STATE["debug_events"]
        self.assertTrue(episode_art_events_ready(events, sequence_after=0, work_id="work-private", generation=7))
        metrics = analyze_episode_art_frame(frame, events=events, sequence_after=0,
                                            work_id="work-private", generation=7)
        self.assertEqual(metrics["status"], "ok")
        self.assertEqual(metrics["crop_count"], 4)
        self.assertTrue(decoded_art_is_accepted(True, metrics))
        self.assertNotIn("episode-target", json.dumps(metrics))
        self.assertNotIn("work-private", json.dumps(metrics))

    def test_card_container_area_uses_preview_route_generation_not_product_focus_generation(self):
        harmony_vnc.apply_state({
            "route": ["Detail"], "kind": [""], "work": ["work-private"], "generation": ["7"],
        })
        base_area = {
            "route": "Detail", "work_id": "work-private", "parent_work_id": "work-private",
            "row_id": "episode-private", "x_vp": 12, "y_vp": 24,
            "width_vp": 134, "height_vp": 95, "density": 2,
        }

        # Product focus generation is independent and stale for PreviewState.
        self.assertFalse(harmony_vnc.append_detail_episode_card_container_area({
            **base_area, "generation": 1,
        }))
        rejected = harmony_vnc.STATE.get("debug_events", [])
        self.assertEqual(len(rejected), 1)
        self.assertEqual(rejected[0]["category"], "detail-layout-episode-card-container-receiver")
        self.assertEqual((rejected[0]["accepted"], rejected[0]["reason_code"]), (0, 2))

        # The captured PreviewState route generation accepts the same geometry.
        self.assertTrue(harmony_vnc.append_detail_episode_card_container_area({
            **base_area, "generation": 7,
        }))
        event = harmony_vnc.STATE["debug_events"][-1]
        self.assertEqual(event["category"], "detail-episode-card-container-area")
        self.assertEqual(event["generation"], 7)
        self.assertEqual(event["width_vp"], 134)

    def test_container_area_event_is_complete_in_atomic_state_snapshot(self):
        harmony_vnc.apply_state({
            "route": ["Detail"], "kind": [""], "work": ["work-private"], "generation": ["7"],
        })
        body = {
            "route": "Detail", "work_id": "work-private", "parent_work_id": "work-private",
            "row_id": "episode-private", "generation": 7, "x_vp": 12, "y_vp": 24,
            "width_vp": 134, "height_vp": 95, "density": 2,
        }
        snapshots = []
        append = harmony_vnc.append_debug_event

        def append_then_snapshot(category, **kwargs):
            event = append(category, **kwargs)
            if category == "detail-episode-card-container-area":
                snapshots.append(harmony_vnc.snapshot_state()["debug_events"][-1])
            return event

        with patch.object(harmony_vnc, "append_debug_event", side_effect=append_then_snapshot):
            self.assertTrue(harmony_vnc.append_detail_episode_card_container_area(body))

        self.assertEqual(len(snapshots), 1)
        event = snapshots[0]
        self.assertEqual(event["category"], "detail-episode-card-container-area")
        self.assertEqual((event["x_vp"], event["y_vp"], event["width_vp"], event["height_vp"], event["density"]),
                         (12, 24, 134, 95, 2))
        self.assertEqual(event["receiver_accepted"], 1)
        self.assertNotEqual(event["category"], "detail-episode-card-area")

    def test_state_snapshot_waits_for_debug_event_publication_lock(self):
        class ObservedLock:
            def __init__(self):
                self.lock = threading.Lock()
                self.contended = threading.Event()

            def __enter__(self):
                if not self.lock.acquire(blocking=False):
                    self.contended.set()
                    self.lock.acquire()
                return self

            def __exit__(self, _type, _value, _traceback):
                self.lock.release()

        original_lock = harmony_vnc.DEBUG_EVENTS_LOCK
        observed_lock = ObservedLock()
        observed_lock.lock.acquire()
        harmony_vnc.DEBUG_EVENTS_LOCK = observed_lock
        try:
            with ThreadPoolExecutor(max_workers=1) as pool:
                snapshot = pool.submit(harmony_vnc.snapshot_state)
                self.assertTrue(observed_lock.contended.wait(timeout=2))
                self.assertFalse(snapshot.done())
                observed_lock.lock.release()
                result = snapshot.result(timeout=2)
        finally:
            if observed_lock.lock.locked():
                observed_lock.lock.release()
            harmony_vnc.DEBUG_EVENTS_LOCK = original_lock
        self.assertIn("debug_events", result)

    def test_image_payload_metrics_are_complete_before_atomic_publication(self):
        harmony_vnc.apply_state({
            "route": ["Detail"], "kind": [""], "work": ["work-private"], "generation": ["7"],
        })
        self.assertTrue(harmony_vnc.append_detail_image_payload_scope({
            "route": "Detail", "work_id": "work-private", "parent_work_id": "work-private",
            "row_id": "episode-private", "generation": 7, "image_id": "998",
        }))
        payload = io.BytesIO()
        Image.new("RGBA", (2, 2), (6, 7, 8, 255)).save(payload, "PNG")
        snapshots = []
        append = harmony_vnc.append_debug_event

        def append_then_snapshot(category, **kwargs):
            event = append(category, **kwargs)
            if category == "detail-image-payload-metrics":
                snapshots.append(harmony_vnc.snapshot_state()["debug_events"][-1])
            return event

        with patch.object(harmony_vnc, "append_debug_event", side_effect=append_then_snapshot):
            harmony_vnc.record_image_upload("998", payload.getvalue())

        self.assertEqual(len(snapshots), 1)
        event = snapshots[0]
        self.assertEqual(event["category"], "detail-image-payload-metrics")
        self.assertEqual(event["mean_red"], 6)
        self.assertNotIn("998", json.dumps(event))

    def test_container_area_receiver_rejection_has_bounded_reason_and_no_ids_in_summary(self):
        harmony_vnc.apply_state({
            "route": ["Detail"], "kind": [""], "work": ["work-private"], "generation": ["7"],
        })
        self.assertFalse(harmony_vnc.append_detail_episode_card_container_area({
            "route": "Detail", "work_id": "work-private", "parent_work_id": "work-private",
            "row_id": "episode-private", "generation": 7, "x_vp": 12, "y_vp": 24,
            "width_vp": 0, "height_vp": 95, "density": 2,
        }))
        event = harmony_vnc.snapshot_state()["debug_events"][-1]
        self.assertEqual(event["category"], "detail-layout-episode-card-container-receiver")
        self.assertEqual((event["accepted"], event["reason_code"]), (0, 4))
        summary = analyze_episode_art_frame(Image.new("RGB", (1920, 1080)), events=harmony_vnc.snapshot_state()["debug_events"],
                                            sequence_after=0, work_id="work-private", generation=7)
        self.assertEqual(summary["container_area_receiver_reject_count"], 1)
        self.assertEqual(summary["container_area_rejection_reason"], "receiver-nonpositive-or-invalid-density")
        encoded = json.dumps(summary)
        self.assertNotIn("work-private", encoded)
        self.assertNotIn("episode-private", encoded)

    def test_container_area_report_stage_keeps_only_scoped_predicates_and_numeric_bounds(self):
        harmony_vnc.apply_state({
            "route": ["Detail"], "kind": [""], "work": ["work-private"], "generation": ["7"],
        })
        self.assertTrue(harmony_vnc.append_detail_layout_stage({
            "route": "Detail", "work_id": "work-private", "generation": 7,
            "stage": "episode-card-container-report", "report_invoked": 1,
            "sender_route_ok": 1, "sender_work_present": 1, "sender_work_matches": 1,
            "sender_generation_matches": 1, "sender_rect_finite": 1, "sender_rect_positive": 1,
            "sender_density_valid": 1, "x_vp": 12, "y_vp": 24, "width_vp": 134,
            "height_vp": 95, "density": 2,
        }))
        layout = summarize_detail_layout_events(harmony_vnc.snapshot_state()["debug_events"],
                                                sequence_after=0, work_id="work-private", generation=7,
                                                started_at=harmony_vnc.STATE["debug_events"][0]["timestamp"])
        report = layout["episode-card-container-report"]
        self.assertEqual(report["count"], 1)
        self.assertEqual(report["sender_generation_matches"]["max"], 1)
        self.assertEqual(report["width_vp"]["max"], 134)
        encoded = json.dumps(layout)
        self.assertNotIn("work-private", encoded)
        self.assertNotIn("episode-private", encoded)
        invalid = {
            "route": "Detail", "work_id": "work-private", "generation": 7,
            "stage": "episode-card-container-report", "report_invoked": True,
            "sender_route_ok": 1, "sender_work_present": 1, "sender_work_matches": 1,
            "sender_generation_matches": 1, "sender_rect_finite": 1, "sender_rect_positive": 1,
            "sender_density_valid": 1,
        }
        self.assertFalse(harmony_vnc.append_detail_layout_stage(invalid))

    def test_debug_sequence_stays_monotonic_when_window_is_capped(self):
        limit = harmony_vnc.DEBUG_EVENT_LIMIT
        for _ in range(limit + 5):
            harmony_vnc.append_debug_event("test")
        self.assertEqual(len(harmony_vnc.STATE["debug_events"]), limit)
        self.assertEqual(harmony_vnc.STATE["debug_sequence"], limit + 5)
        self.assertEqual(harmony_vnc.STATE["debug_events"][0]["sequence"], 6)

    def test_parallel_debug_appends_have_unique_monotonic_sequences_without_loss(self):
        count = 32
        start = threading.Barrier(count)

        def append(index):
            start.wait(timeout=5)
            return harmony_vnc.append_debug_event(f"parallel-{index}")

        with ThreadPoolExecutor(max_workers=count) as executor:
            returned = list(executor.map(append, range(count)))

        events = harmony_vnc.STATE["debug_events"]
        sequences = [event["sequence"] for event in events]
        self.assertEqual(len(events), count)
        self.assertEqual(sequences, list(range(1, count + 1)))
        self.assertEqual(harmony_vnc.STATE["debug_sequence"], count)
        self.assertEqual(sorted(event["sequence"] for event in returned), sequences)
        self.assertEqual({event["category"] for event in events},
                         {f"parallel-{index}" for index in range(count)})

    def test_parallel_layout_and_card_area_updates_stay_with_their_appended_events(self):
        append_barrier = threading.Barrier(3)
        original_append = harmony_vnc.append_debug_event

        def append_then_release(*args, **kwargs):
            event = original_append(*args, **kwargs)
            append_barrier.wait(timeout=5)
            return event

        layout = {
            "route": "Detail", "work_id": "test-work", "generation": 9,
            "stage": "series-target-season-row-area", "value": 101,
            "width": 11, "height": 12, "title": "private-title", "url": "private-url",
        }
        card_area = {
            "route": "Detail", "work_id": "test-work", "parent_work_id": "test-work",
            "row_id": "row-a", "generation": 9, "x_vp": 21, "y_vp": 31,
            "width_vp": 101, "height_vp": 51, "density": 2,
        }
        container_area = {
            **card_area, "row_id": "row-b", "x_vp": 22, "y_vp": 32,
            "width_vp": 102, "height_vp": 52,
        }

        with patch.object(harmony_vnc, "append_debug_event", side_effect=append_then_release):
            with ThreadPoolExecutor(max_workers=3) as executor:
                accepted = list(executor.map(
                    lambda operation: operation(),
                    (
                        lambda: harmony_vnc.append_detail_layout_stage(layout),
                        lambda: harmony_vnc.append_detail_episode_card_area(card_area),
                        lambda: harmony_vnc.append_detail_episode_card_container_area(container_area),
                    ),
                ))

        self.assertEqual(accepted, [True, True, True])
        events = harmony_vnc.STATE["debug_events"]
        self.assertEqual(len(events), 3)
        self.assertEqual([event["sequence"] for event in events], [1, 2, 3])
        by_category = {event["category"]: event for event in events}

        layout_event = by_category["detail-layout-series-target-season-row-area"]
        self.assertEqual((layout_event["value"], layout_event["width"], layout_event["height"],
                          layout_event["area"]), (101, 11, 12, 132))
        card_event = next(event for event in events if event["category"] == "detail-episode-card-area")
        self.assertEqual((card_event["row_id"], card_event["x_vp"], card_event["width_vp"]),
                         ("row-a", 21, 101))
        container_event = by_category["detail-episode-card-container-area"]
        self.assertEqual((container_event["row_id"], container_event["x_vp"], container_event["width_vp"]),
                         ("row-b", 22, 102))
        encoded = json.dumps(events)
        self.assertNotIn("private-title", encoded)
        self.assertNotIn("private-url", encoded)
        self.assertNotIn('"title"', encoded)
        self.assertNotIn('"url"', encoded)

    def test_repeated_readiness_target_marker_survives_capped_debug_window(self):
        harmony_vnc.apply_state({
            "route": ["Detail"], "kind": [""], "work": ["work-private"], "generation": ["7"],
        })
        target = {
            "route": "Detail", "work_id": "work-private", "parent_work_id": "work-private",
            "row_id": "target-private", "generation": 7,
        }
        self.assertTrue(harmony_vnc.append_detail_episode_target(target))
        for _ in range(harmony_vnc.DEBUG_EVENT_LIMIT + 5):
            harmony_vnc.append_debug_event("image-traffic")
        self.assertFalse(any(event.get("category") == "detail-episode-target"
                             for event in harmony_vnc.STATE["debug_events"]))
        self.assertTrue(harmony_vnc.append_detail_episode_target(target))
        latest = [event for event in harmony_vnc.STATE["debug_events"]
                  if event.get("category") == "detail-episode-target"]
        self.assertEqual(len(latest), 1)
        self.assertEqual(latest[0]["row_id"], "target-private")

    def test_stale_route_report_cannot_rewind_preview_generation(self):
        harmony_vnc.apply_state({
            "route": ["Detail"], "kind": [""], "work": ["work-a"], "generation": ["7"],
        })
        harmony_vnc.apply_state({
            "route": ["Home"], "kind": [""], "work": [""], "generation": ["6"],
        })
        self.assertEqual(harmony_vnc.STATE["route"], "Detail")
        self.assertEqual(harmony_vnc.STATE["work_id"], "work-a")
        self.assertEqual(harmony_vnc.STATE["route_generation"], 7)


if __name__ == "__main__":
    unittest.main()
