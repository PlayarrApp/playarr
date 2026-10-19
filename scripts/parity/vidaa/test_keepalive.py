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


class AfterMiss(unittest.TestCase):
    def test_one_miss_keeps_the_session(self):
        self.assertEqual(keepalive.after_miss(1, 0, 100.0), (False, 0, 0.0))

    def test_repeated_flapping_backs_off_instead_of_retrying_every_15_s(self):
        backoff, waits = 0, []
        for _ in range(4):
            gone, backoff, due = keepalive.after_miss(2, backoff, 1000.0)
            self.assertTrue(gone)
            waits.append(due - 1000.0)
        self.assertEqual(waits, [15, 30, 60, 120])


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
