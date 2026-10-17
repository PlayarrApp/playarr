import json
import hashlib
import subprocess
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
sys.path.extend((str(HERE), str(HERE.parent / "sim-vnc")))
import harmony_vnc


class PreviewTelemetryBatchTests(unittest.TestCase):
    def setUp(self):
        with harmony_vnc.PREVIEW_TELEMETRY_BATCH_LOCK:
            harmony_vnc.PREVIEW_TELEMETRY_BATCH_LAST_ID = 0
            harmony_vnc.PREVIEW_TELEMETRY_BATCH_DIGESTS.clear()

    @staticmethod
    def digest(events, batch_id):
        return hashlib.sha256(json.dumps({"batch_id": batch_id, "events": events}, separators=(",", ":"))
                              .encode()).hexdigest()

    def test_actual_sender_queue_and_one_shot_batching(self):
        version = subprocess.run(["node", "--version"], capture_output=True, text=True, timeout=5)
        major = int(version.stdout.strip().lstrip("v").split(".")[0])
        if major < 22:
            self.skipTest("the production TypeScript sender test requires Node 22 type stripping")
        command = ["node", "--experimental-strip-types", str(HERE / "test_preview_telemetry_sender.mjs")]
        result = subprocess.run(command, cwd=HERE.parent.parent, capture_output=True, text=True, timeout=15)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_large_ordered_mixed_telemetry_uses_bounded_one_shot_batches(self):
        total_events = 8193
        events = []
        expected_order = []
        for index in range(total_events):
            if index % 2 == 0:
                events.append({"method": "GET", "path": "/state?dbg=event-" + str(index), "body": ""})
                expected_order.append("GET:" + str(index))
            else:
                events.append({"method": "POST", "path": "/detail-load",
                               "body": json.dumps({"marker": index})})
                expected_order.append("POST:" + str(index))

        actual_order = []

        def record_state(query):
            actual_order.append("GET:" + query["dbg"][0].removeprefix("event-"))

        def record_post(body):
            actual_order.append("POST:" + str(body["marker"]))
            return True

        batches = [events[offset:offset + harmony_vnc.MAX_PREVIEW_TELEMETRY_BATCH_SIZE]
                   for offset in range(0, len(events), harmony_vnc.MAX_PREVIEW_TELEMETRY_BATCH_SIZE)]
        with patch.object(harmony_vnc, "apply_state", side_effect=record_state), \
                patch.object(harmony_vnc, "append_detail_load_event", side_effect=record_post):
            self.assertTrue(all(harmony_vnc.dispatch_preview_telemetry_batch(batch_id, batch,
                            self.digest(batch, batch_id)) for batch_id, batch in enumerate(batches, 1)))

        self.assertEqual(actual_order, expected_order)
        self.assertEqual(len(batches), 129)
        self.assertEqual(len(batches), (total_events + harmony_vnc.MAX_PREVIEW_TELEMETRY_BATCH_SIZE - 1)
                         // harmony_vnc.MAX_PREVIEW_TELEMETRY_BATCH_SIZE)
        self.assertLess(len(batches), 8192)

    def test_stale_scoped_event_is_acknowledged_and_dropped(self):
        event = {"method": "POST", "path": "/detail-load", "body": json.dumps({"generation": 1})}
        with patch.object(harmony_vnc, "append_detail_load_event", return_value=False) as append_event:
            self.assertTrue(harmony_vnc.dispatch_preview_telemetry_batch(1, [event], self.digest([event], 1)))
        append_event.assert_called_once()

    def test_lost_response_retry_is_deduplicated_and_conflicting_replay_rejected(self):
        event = {"method": "POST", "path": "/detail-load", "body": json.dumps({"marker": "sample"})}
        digest = self.digest([event], 1)
        with patch.object(harmony_vnc, "append_detail_load_event", return_value=True) as apply_event:
            self.assertTrue(harmony_vnc.dispatch_preview_telemetry_batch(1, [event], digest))
            # The client did not receive the first response and resends the identical batch.
            self.assertTrue(harmony_vnc.dispatch_preview_telemetry_batch(1, [event], digest))
            self.assertFalse(harmony_vnc.dispatch_preview_telemetry_batch(1, [event], "0" * 64))
            self.assertFalse(harmony_vnc.dispatch_preview_telemetry_batch(3, [event], self.digest([event], 3)))
        apply_event.assert_called_once()

    def test_batch_validation_is_atomic_and_rejects_oversize_or_malformed_payloads(self):
        events = [
            {"method": "GET", "path": "/state?dbg=before", "body": ""},
            {"method": "POST", "path": "/unknown", "body": "{}"},
            {"method": "POST", "path": "/detail-load", "body": "{}"},
        ]
        with patch.object(harmony_vnc, "apply_state") as apply_state, \
                patch.object(harmony_vnc, "append_detail_load_event") as append_event:
            self.assertFalse(harmony_vnc.dispatch_preview_telemetry_batch(1, events, self.digest(events, 1)))
            apply_state.assert_not_called()
            append_event.assert_not_called()
        self.assertIsNone(harmony_vnc.validate_preview_telemetry_batch(
            [{"method": "POST", "path": "/detail-load", "body": "{"}]))
        oversized = [{"method": "GET", "path": "/state?dbg=x", "body": ""}]
        oversized *= harmony_vnc.MAX_PREVIEW_TELEMETRY_BATCH_SIZE + 1
        self.assertFalse(harmony_vnc.dispatch_preview_telemetry_batch(1, oversized, self.digest(oversized, 1)))


if __name__ == "__main__":
    unittest.main()
