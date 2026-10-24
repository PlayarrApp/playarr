import os
import sys
import tempfile
import types
import unittest
from unittest import mock

os.environ.setdefault("PLAYARR_DATA_DIR", ".")
import broker
import keepalive

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


class NoDirectSession(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        env = {"VIDAA_KEEPALIVE_LOCK": os.path.join(self.dir.name, "k.lock"), "VIDAA_SOCK": os.path.join(self.dir.name, "none.sock")}
        self.patch = mock.patch.dict(os.environ, env)
        self.patch.start()

    def tearDown(self):
        self.patch.stop()
        self.dir.cleanup()

    def test_lock_is_exclusive_and_visible(self):
        self.assertFalse(broker.keepalive_running())
        fd = broker.hold_lock()
        self.assertIsNotNone(fd)
        self.assertTrue(broker.keepalive_running())
        self.assertIsNone(broker.hold_lock())  # a second keepalive is refused
        os.close(fd)
        self.assertFalse(broker.keepalive_running())

    def test_cli_refuses_direct_session_while_keepalive_runs(self):
        fd = broker.hold_lock()
        try:
            with mock.patch.object(vidaa, "Tv") as tv, self.assertRaises(SystemExit) as e:
                vidaa.via_broker("state", None)  # socket missing but keepalive holds the lock
            self.assertIn("keepalive owns the TV session", str(e.exception.code))
            tv.assert_not_called()
            with mock.patch.object(vidaa, "Tv") as tv, self.assertRaises(SystemExit):
                vidaa.connect()  # volume / events use connect() directly
            tv.assert_not_called()
        finally:
            os.close(fd)

    def test_keepalive_itself_and_the_override_may_connect(self):
        fd = broker.hold_lock()
        try:
            with mock.patch.object(vidaa, "Tv") as tv:
                vidaa.connect(owner=True)
                with mock.patch.dict(os.environ, {"VIDAA_ALLOW_DIRECT": "1"}):
                    vidaa.connect()
            self.assertEqual(tv.call_count, 2)
        finally:
            os.close(fd)


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


class ErgonOperations(unittest.TestCase):
    def setUp(self):
        self.session = types.SimpleNamespace(tv=mock.Mock(), lock=__import__("threading").RLock())
        self.handle = keepalive.make_handler(vidaa, self.session)
        self.session.tv.apps.return_value = [{"name": "TV Browser", "appId": "16", "url": "browser"}]

    def test_state_action_returns_state(self):
        self.session.tv.state.return_value = {"statetype": "browser"}
        self.assertEqual(self.handle({"op": "ergon", "action": "state"}), '{"statetype": "browser"}')

    def test_allowed_key_skips_mirror_and_foreground_checks(self):
        with mock.patch.object(keepalive, "log") as log, \
             mock.patch.object(vidaa, "require_device_test_account", side_effect=AssertionError("mirror check")), \
             mock.patch.object(vidaa, "foreground_ok", side_effect=AssertionError("foreground check")), \
             mock.patch.object(vidaa.time, "sleep"):
            self.assertEqual(self.handle({"op": "ergon", "action": "key", "keys": ["KEY_UP"]}), "sent KEY_UP")
        self.assertTrue(log.call_args.args[0].startswith('ergon: {"action": "key"'))
        self.session.tv.pub.assert_called_once_with("remote_service", "sendkey", "KEY_UP")

    def test_refuses_non_navigation_key(self):
        with mock.patch.object(vidaa, "require_device_test_account") as account, \
             self.assertRaises(SystemExit) as error:
            self.handle({"op": "ergon", "action": "key", "keys": ["KEY_UP", "KEY_POWER"]})
        self.assertIn("not an allowed navigation key", error.exception.code)
        account.assert_not_called()
        self.session.tv.pub.assert_not_called()

    def test_launches_only_builtin_browser_entry(self):
        self.assertEqual(self.handle({"op": "ergon", "action": "launch", "app": "16"}), "launch requested: TV Browser")
        self.session.tv.pub.assert_called_once_with("ui_service", "launchapp", {"name": "TV Browser", "appId": "16", "url": "browser"})

    def test_refuses_other_app(self):
        with self.assertRaises(SystemExit) as error:
            self.handle({"op": "ergon", "action": "launch", "app": "3"})
        self.assertIn("only the built-in TV Browser", error.exception.code)
        self.session.tv.pub.assert_not_called()

    def test_existing_key_operation_still_checks_mirror_account(self):
        with mock.patch.object(vidaa, "foreground_ok", return_value=(True, {})), \
             mock.patch.object(vidaa, "require_device_test_account", side_effect=SystemExit("mirror check")), \
             mock.patch.object(vidaa.time, "sleep"):
            with self.assertRaises(SystemExit) as error:
                self.handle({"op": "key", "keys": ["KEY_UP"], "allow_any": True, "delay": 0})
        self.assertEqual(error.exception.code, "mirror check")
        self.session.tv.pub.assert_not_called()


if __name__ == "__main__":
    unittest.main()
