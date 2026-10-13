import io
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch
from PIL import Image

HERE = Path(__file__).resolve().parent
sys.path.extend((str(HERE), str(HERE.parent / "sim-vnc")))
import harmony_vnc
from capture_diagnostics import summarize_detail_image_payload_events


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

    def test_debug_sequence_stays_monotonic_when_window_is_capped(self):
        for _ in range(305):
            harmony_vnc.append_debug_event("test")
        self.assertEqual(len(harmony_vnc.STATE["debug_events"]), 300)
        self.assertEqual(harmony_vnc.STATE["debug_sequence"], 305)
        self.assertEqual(harmony_vnc.STATE["debug_events"][0]["sequence"], 6)

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
