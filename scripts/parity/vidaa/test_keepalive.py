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


if __name__ == "__main__":
    unittest.main()
