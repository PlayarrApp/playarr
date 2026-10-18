import importlib.util
import unittest

spec = importlib.util.spec_from_file_location("uiexpect_once", __file__.replace(".test.py", ".py"))
uiexpect_once = importlib.util.module_from_spec(spec)
spec.loader.exec_module(uiexpect_once)


class FreshHierarchyTest(unittest.TestCase):
    def test_requires_all_patterns_on_visible_nodes(self):
        xml = b'<hierarchy><node visible-to-user="true" bounds="[0,0][80,30]" text="Season 1"/><node visible-to-user="true" bounds="[80,0][180,30]" text="12 Episodes"/></hierarchy>'
        self.assertTrue(uiexpect_once.matching_nodes(xml, ["season", "episodes"], 2560, 1600))
        self.assertFalse(uiexpect_once.matching_nodes(xml, ["season", "calendar"], 2560, 1600))

    def test_ignores_invisible_and_offscreen_nodes(self):
        xml = b'<hierarchy><node visible-to-user="false" bounds="[0,0][80,30]" text="Calendar"/><node bounds="[2600,0][2700,30]" text="Today"/></hierarchy>'
        self.assertFalse(uiexpect_once.matching_nodes(xml, ["calendar"], 2560, 1600))
        self.assertFalse(uiexpect_once.matching_nodes(xml, ["today"], 2560, 1600))

    def test_accepts_standard_uiautomator_nodes_without_visibility_attribute(self):
        xml = b'<hierarchy><node bounds="[20,40][200,80]" text="Calendar"/></hierarchy>'
        self.assertTrue(uiexpect_once.matching_nodes(xml, ["calendar"], 2560, 1600))

    def test_rejects_malformed_or_unexpected_hierarchies(self):
        with self.assertRaises(Exception):
            uiexpect_once.matching_nodes(b"<not-hierarchy/>", ["x"], 2560, 1600)
        with self.assertRaises(Exception):
            uiexpect_once.matching_nodes(b"<hierarchy>", ["x"], 2560, 1600)


if __name__ == "__main__":
    unittest.main()
