import os
import tempfile
import unittest
from pathlib import Path

import preview_handoff


class PreviewHandoffContractTests(unittest.TestCase):
    def test_generated_build_output_contains_every_preview_input(self):
        root = Path(os.environ.get("PREVIEW_ROOT", Path(__file__).parents[2] / "app/entry/.preview"))
        missing = preview_handoff.check_output(root)
        self.assertEqual([], missing, "run PreviewBuild before checking its handoff")

    def test_artifact_upload_and_both_previewer_setups_match_contract(self):
        self.assertEqual([], preview_handoff.check_workflow(preview_handoff.WORKFLOW))

    def test_missing_generated_router_map_fails_the_handoff(self):
        with tempfile.TemporaryDirectory() as directory:
            work_root = Path(directory)
            root = work_root / "app/entry/.preview"
            for relative in preview_handoff.REQUIRED_FILES:
                if relative.endswith("router_map.json"):
                    continue
                target = root / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                target.touch()
            (work_root / "hms-previewer/systemHsp").mkdir(parents=True)
            missing = preview_handoff.check_output(root)
            self.assertEqual(
                [str(root / "default/intermediates/router_map/default/router_map.json")],
                missing,
            )

    def test_pkg_context_info_is_not_a_previewer_input(self):
        self.assertFalse(any("pkgContextInfo.json" in path for path in preview_handoff.REQUIRED_FILES))


if __name__ == "__main__":
    unittest.main()
