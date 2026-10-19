import os
import unittest

os.environ.setdefault("PLAYARR_DATA_DIR", ".")
import keepalive


class Backoff(unittest.TestCase):
    def test_doubles_and_caps(self):
        seq, b = [], 0
        for _ in range(7):
            b = keepalive.next_backoff(b)
            seq.append(b)
        self.assertEqual(seq, [15, 30, 60, 120, 240, 300, 300])


class Probe(unittest.TestCase):
    def test_alive_follows_applist_not_state(self):
        from unittest import mock
        vidaa = mock.Mock(foreground_ok=mock.Mock(return_value=(False, None)))
        tv = mock.Mock(apps=mock.Mock(return_value=[{"name": "Playarr"}]))
        self.assertEqual(keepalive.probe(vidaa, tv), (True, False, None))  # no state reply, still alive
        tv.apps.return_value = None
        self.assertEqual(keepalive.probe(vidaa, tv)[0], False)


if __name__ == "__main__":
    unittest.main()
