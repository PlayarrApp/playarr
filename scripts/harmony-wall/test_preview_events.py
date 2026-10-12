import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.extend((str(HERE), str(HERE.parent / "sim-vnc")))
import harmony_vnc


class PreviewEventTests(unittest.TestCase):
    def setUp(self):
        self.state = dict(harmony_vnc.STATE)
        self.sequence = harmony_vnc.DEBUG_SEQUENCE
        harmony_vnc.STATE.clear()
        harmony_vnc.STATE.update({"route": "", "kind": "", "focused": None, "lib_kind": ""})
        harmony_vnc.DEBUG_SEQUENCE = 0

    def tearDown(self):
        harmony_vnc.STATE.clear()
        harmony_vnc.STATE.update(self.state)
        harmony_vnc.DEBUG_SEQUENCE = self.sequence

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
        self.assertNotIn("width", harmony_vnc.STATE["debug_events"][-1])
        self.assertNotIn("height", harmony_vnc.STATE["debug_events"][-1])
        self.assertFalse(harmony_vnc.append_detail_image_stage(dict(body, stage="bad", row_id="row-b")))
        self.assertFalse(harmony_vnc.append_detail_image_stage(dict(body, generation=6)))

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
        self.assertFalse(harmony_vnc.append_detail_layout_stage(dict(body, generation=6)))
        self.assertFalse(harmony_vnc.append_detail_layout_stage(dict(body, work_id="work-b")))
        self.assertFalse(harmony_vnc.append_detail_layout_stage(dict(body, stage="private-title")))
        self.assertFalse(harmony_vnc.append_detail_layout_stage(dict(body, width="1280")))
        self.assertFalse(harmony_vnc.append_detail_layout_stage(dict(body, height=float("nan"))))

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
