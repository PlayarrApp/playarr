import os, subprocess, sys, tempfile, unittest

SRC = """import { x } from './x';

@Component
struct Card {
  build() {
    Column() {
      Text('a')
    }
    .width(10)
  }
}

@Builder
function Free() {
  Row() {
  }
}
"""


class PatchHideTest(unittest.TestCase):
    def test_keys_every_call_and_binds_structs_only(self):
        with tempfile.TemporaryDirectory() as d:
            os.makedirs(os.path.join(d, "util"))
            open(os.path.join(d, "Card.ets"), "w").write(SRC)
            subprocess.run([sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)), "patch_hide.py"), d], check=True, capture_output=True)
            out = open(os.path.join(d, "Card.ets")).read()
        self.assertIn("@StorageLink('pvHid') pvHid: string = '';", out)
        self.assertIn("Text('a').id('pvh2').visibility(pvVis(this.pvHid, 'pvh2'))", out)
        self.assertIn("}.id('pvh1').visibility(pvVis(this.pvHid, 'pvh1'))\n    .width(10)", out)  # after the closure, before the app's own attributes
        self.assertIn("}.id('pvh3').visibility(pvVis('', 'pvh3'))", out)  # a global builder has no state: never hidden
        self.assertEqual(out.count("@StorageLink"), 1)


if __name__ == "__main__":
    unittest.main()
