import unittest
from layout_export import export


def flat(text, size, w):
    return w * size * 0.5


class LayoutExportTest(unittest.TestCase):
    def test_text_rect_uses_content_area_and_colours_composite(self):
        tree = {"$type": "root", "$rect": "[0.00, 0.00],[1080.00, 2340.00]", "$attrs": {"backgroundColor": "#FF151315"}, "$children": [
            {"$type": "Text", "$rect": "[30.00, 300.00],[970.00, 72.00]",
             "$attrs": {"content": "Hello  world", "fontSize": "16.00fp", "fontFamily": "NunitoSansW610", "fontColor": "#FFF4F0F1", "letterSpacing": "0.00vp"}}]}
        doc = export(tree, "x", "dark", (360, 780, 3), measure=lambda t, s, w: 100.0)
        t = [e for e in doc["elements"] if e["role"] == "text"][0]
        self.assertEqual(t["text"], "Hello world")
        self.assertEqual(t["fontWeight"], 610)
        self.assertEqual(t["rect"], {"x": 10.0, "y": 101.0, "w": 100.0, "h": 22})
        self.assertEqual(t["color"], "#f4f0f1")
        self.assertEqual(t["background"], "#151315")


if __name__ == "__main__":
    unittest.main()
