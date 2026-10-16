"""Keep the capture entry point parseable before starting the Previewer."""

import ast
import unittest
from pathlib import Path


class CaptureSyntaxTests(unittest.TestCase):
    def test_capture_entry_point_parses(self):
        source = Path(__file__).with_name("capture.py").read_text(encoding="utf-8")
        ast.parse(source, filename="capture.py")


if __name__ == "__main__":
    unittest.main()
