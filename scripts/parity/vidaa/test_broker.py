import os
import sys
import tempfile
import types
import unittest
from unittest import mock

os.environ.setdefault("PLAYARR_DATA_DIR", ".")
import broker

# vidaa.py needs paho only to open a real session; the tests never do.
for name in ("paho", "paho.mqtt", "paho.mqtt.client"):
    sys.modules.setdefault(name, types.ModuleType(name))
import vidaa


class Socket(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.dir.name, "v.sock")
        self.seen = []
        self.server = None

    def tearDown(self):
        if self.server:
            self.server.shutdown()
            self.server.server_close()
        self.dir.cleanup()

    def start(self):
        def handler(req):
            self.seen.append(req)
            if req["op"] == "refuse":
                raise SystemExit("refused: KEY_POWER is blocked by policy")
            if req["op"] == "boom":
                raise ValueError("bad")
            return f"done {req['op']}"
        self.server = broker.serve(self.path, handler)

    def test_roundtrip_and_errors(self):
        self.start()
        self.assertEqual(broker.call({"op": "state"}, self.path), {"ok": True, "result": "done state"})
        self.assertEqual(broker.call({"op": "refuse"}, self.path), {"ok": False, "error": "refused: KEY_POWER is blocked by policy"})
        self.assertEqual(broker.call({"op": "boom"}, self.path), {"ok": False, "error": "ValueError: bad"})
        self.assertEqual(oct(os.stat(self.path).st_mode & 0o777), "0o600")

    def test_call_is_none_when_nothing_listens(self):
        self.assertIsNone(broker.call({"op": "state"}, self.path))  # no socket file
        open(self.path, "w").close()
        self.assertIsNone(broker.call({"op": "state"}, self.path))  # stale file, no listener

    def test_via_broker_uses_socket_and_skips_direct_connect(self):
        self.start()
        with mock.patch.dict(os.environ, {"VIDAA_SOCK": self.path}), mock.patch.object(vidaa, "connect") as connect:
            self.assertEqual(vidaa.via_broker("state", None), "done state")
            with self.assertRaises(SystemExit) as e:
                vidaa.via_broker("refuse", None)
            self.assertIn("blocked by policy", str(e.exception.code))
        connect.assert_not_called()

    def test_via_broker_falls_back_to_one_direct_session(self):
        tv = mock.Mock()
        direct = mock.Mock(return_value="direct")
        with mock.patch.dict(os.environ, {"VIDAA_SOCK": self.path}), mock.patch.object(vidaa, "connect", return_value=tv) as connect:
            self.assertEqual(vidaa.via_broker("key", direct, keys=["KEY_UP", "KEY_OK"]), "direct")
        connect.assert_called_once()
        direct.assert_called_once_with(tv, keys=["KEY_UP", "KEY_OK"])
        tv.close.assert_called_once()


class KeyPacing(unittest.TestCase):
    def test_keys_keep_the_minimum_gap(self):
        sent = []
        tv = mock.Mock()
        tv.pub.side_effect = lambda *a: sent.append(__import__("time").time())
        with mock.patch.object(vidaa, "foreground_ok", return_value=(True, {})), mock.patch.object(vidaa, "require_device_test_account"):
            vidaa.op_key(tv, ["KEY_UP", "KEY_DOWN", "KEY_OK"], delay=0)
        gaps = [b - a for a, b in zip(sent, sent[1:])]
        self.assertTrue(all(g >= vidaa.MIN_KEY_GAP - 0.01 for g in gaps), gaps)

    def test_blocked_key_is_refused_after_earlier_keys_sent(self):
        tv = mock.Mock()
        with mock.patch.object(vidaa, "foreground_ok", return_value=(True, {})), mock.patch.object(vidaa, "require_device_test_account"):
            with self.assertRaises(SystemExit) as e:
                vidaa.op_key(tv, ["KEY_UP", "KEY_POWER"], delay=0)
        self.assertIn("sent KEY_UP", e.exception.code)
        self.assertIn("KEY_POWER is blocked", e.exception.code)
        tv.pub.assert_called_once()


if __name__ == "__main__":
    unittest.main()
