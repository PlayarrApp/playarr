import importlib.util
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("harmony_patch_drawer", HERE / "patch_drawer.py")
patch_drawer = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(patch_drawer)


class DrawerPreviewPatchTests(unittest.TestCase):
    def test_preview_transform_only_removes_blur_from_the_copied_source(self):
        production_path = HERE.parents[1] / "clients/harmony/entry/src/main/ets/design/components/Drawer.ets"
        production_source = production_path.read_text(encoding="utf-8")
        web_capture_source = (HERE.parents[1] / "scripts/parity/capture-web.mjs").read_text(encoding="utf-8")
        transformed = patch_drawer.transform(production_source)

        self.assertIn("backdrop-filter:none!important", web_capture_source)
        self.assertIn("-webkit-backdrop-filter:none!important", web_capture_source)
        self.assertIn(".backdropBlur(DRAWER_BACKDROP_BLUR)", production_source)
        self.assertIn("const DRAWER_BACKDROP_BLUR: number = 38;", production_source)
        self.assertNotIn(".backdropBlur(DRAWER_BACKDROP_BLUR)", transformed)
        self.assertNotIn("const DRAWER_BACKDROP_BLUR: number = 38;", transformed)
        self.assertIn("Phone preview parity: match capture-web.mjs FREEZE_CSS", transformed)
        self.assertEqual(production_path.read_text(encoding="utf-8"), production_source)

    def test_transform_is_idempotent_and_rejects_partial_application(self):
        source = "const DRAWER_BACKDROP_BLUR: number = 38;\n    .backdropBlur(DRAWER_BACKDROP_BLUR)\n"
        transformed = patch_drawer.transform(source)
        self.assertEqual(patch_drawer.transform(transformed), transformed)

        with self.assertRaisesRegex(AssertionError, "modifier not found exactly once"):
            patch_drawer.transform("const DRAWER_BACKDROP_BLUR: number = 38;\n")
        with self.assertRaisesRegex(AssertionError, "modifier not found exactly once"):
            patch_drawer.transform(source + "    .backdropBlur(DRAWER_BACKDROP_BLUR)\n")
        with self.assertRaisesRegex(AssertionError, "modifier remains"):
            patch_drawer.transform(transformed + "    .backdropBlur(DRAWER_BACKDROP_BLUR)\n")

    def test_cli_transforms_only_the_target_copy(self):
        source = "const DRAWER_BACKDROP_BLUR: number = 38;\n    .backdropBlur(DRAWER_BACKDROP_BLUR)\n"
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "Drawer.ets"
            target.write_text(source, encoding="utf-8")
            subprocess.run([sys.executable, str(HERE / "patch_drawer.py"), str(target)], check=True)
            transformed = target.read_text(encoding="utf-8")
            self.assertIn("Phone preview parity", transformed)
            self.assertNotIn("backdropBlur", transformed)
            self.assertNotEqual(transformed, source)


if __name__ == "__main__":
    unittest.main()
