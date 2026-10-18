import subprocess
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent


class PreviewCardSelectorTests(unittest.TestCase):
    def test_production_selector_on_phone_and_tv_geometry(self):
        version = subprocess.run(["node", "--version"], capture_output=True, text=True, timeout=5)
        major = int(version.stdout.strip().lstrip("v").split(".")[0])
        if major < 22:
            self.skipTest("the production TypeScript selector test requires Node 22 type stripping")
        command = ["node", "--experimental-strip-types", str(HERE / "test_preview_card_selector.mjs")]
        result = subprocess.run(command, cwd=HERE.parent.parent, capture_output=True, text=True, timeout=15)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
