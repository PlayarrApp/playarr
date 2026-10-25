import unittest
from layout_export import ExportError, export


def column(children, rect="[0.00, 0.00],[1080.00, 2340.00]", fill="#FF151315", **attrs):
    return {"$type": "Column", "$rect": rect, "$attrs": dict({"backgroundColor": fill}, **attrs), "$children": children}


def run(start, end, l, t, r, b):
    return {"start": start, "end": end, "ascent": (b - t) * 0.8, "descent": (b - t) * 0.2, "top": t, "tight": [{"l": l, "t": t, "r": r, "b": b}], "max": []}


def text(rect, content, runs, **attrs):
    node = {"$type": "Text", "$rect": rect, "$attrs": dict({"content": content, "fontSize": "16.00fp", "fontFamily": "NunitoSansW610", "fontColor": "#FFF4F0F1"}, **attrs)}
    if runs is not None:
        node["$runs"] = runs
    return node


class LayoutExportTest(unittest.TestCase):
    def test_text_rect_is_the_union_of_the_layout_managers_run_boxes(self):
        tree = column([text("[30.00, 300.00],[970.00, 72.00]", "Hello  world", [run(0, 12, 0.0, 3.0, 300.0, 69.0)])])
        doc = export(tree, "x", "dark", (360, 780, 3))
        t = [e for e in doc["elements"] if e["role"] == "text"][0]
        self.assertEqual(t["text"], "Hello world")
        self.assertEqual(t["fontWeight"], 610)
        self.assertEqual(t["rect"], {"x": 10.0, "y": 101.0, "w": 100.0, "h": 22.0})
        self.assertEqual(t["color"], "#f4f0f1")
        self.assertEqual(t["background"], "#151315")

    def test_padding_moves_the_content_origin(self):
        tree = column([text("[30.00, 300.00],[970.00, 72.00]", "Hi", [run(0, 2, 0.0, 0.0, 30.0, 20.0)], padding="{\"top\":\"3.00vp\",\"left\":\"1.00vp\"}")])
        t = [e for e in export(tree, "x", "dark", (360, 780, 3))["elements"] if e["role"] == "text"][0]
        self.assertEqual((t["rect"]["x"], t["rect"]["y"]), (11.0, 103.0))

    def test_a_wrapped_text_exports_one_element_per_line(self):
        runs = [run(0, 8, 0.0, 0.0, 90.0, 20.0), run(8, 13, 0.0, 24.0, 50.0, 44.0)]
        tree = column([text("[0.00, 0.00],[200.00, 48.00]", "one two three", runs)], rect="[0.00, 0.00],[1920.00, 1080.00]")
        t = [e for e in export(tree, "x", "dark", (1920, 1080, 1))["elements"] if e["role"] == "text"]
        self.assertEqual([e["text"] for e in t], ["one two", "three"])
        self.assertEqual([round(e["rect"]["y"] - t[0]["rect"]["y"], 2) for e in t], [0.0, 24.0])

    def test_the_inspector_box_already_holds_the_scale_so_only_the_text_is_scaled(self):
        inner = text("[10.00, 10.00],[31.50, 10.50]", "Movies", [run(0, 6, 0.0, 0.0, 30.0, 10.0)])
        tile = {"$type": "Column", "$rect": "[0.00, 0.00],[67.20, 67.20]", "$attrs": {"id": "px:link:Movies", "backgroundColor": "#17F4F0F1", "scale": {"x": "1.050000", "y": "1.050000"}}, "$children": [inner]}
        doc = export(column([tile], rect="[0.00, 0.00],[1920.00, 1080.00]"), "x", "dark", (1920, 1080, 1))
        link = [e for e in doc["elements"] if e["role"] == "link"][0]
        self.assertEqual((link["rect"]["w"], link["rect"]["h"]), (67.2, 67.2))
        t = [e for e in doc["elements"] if e["role"] == "text"][0]
        self.assertEqual((t["rect"]["w"], t["fontSize"]), (31.5, 16.8))  # drawn at 1.05

    def test_a_text_without_glyph_runs_fails_the_export(self):
        tree = column([text("[0.00, 0.00],[200.00, 48.00]", "unmeasured", None)], rect="[0.00, 0.00],[1920.00, 1080.00]")
        with self.assertRaises(ExportError):
            export(tree, "x", "dark", (1920, 1080, 1))

    def test_nothing_is_synthesised_for_an_empty_tree(self):
        doc = export(column([]), "player-controls", "dark", (1920, 1080, 1))
        self.assertEqual([e["role"] for e in doc["elements"]], ["container"])

    def test_controls_use_the_apps_accessible_name_and_box(self):
        tree = column([{"$type": "Row", "$rect": "[100.00, 100.00],[64.00, 64.00]", "$attrs": {"id": "px:button:Play", "backgroundColor": "#33FFFFFF", "borderRadius": "32.00vp"}, "$children": []}],
                      rect="[0.00, 0.00],[1920.00, 1080.00]")
        b = [e for e in export(tree, "x", "dark", (1920, 1080, 1))["elements"] if e["role"] == "button"][0]
        self.assertEqual((b["text"], b["rect"]["w"], b["radius"]), ("Play", 64.0, 32.0))

    def test_a_text_that_is_the_control_exports_its_lines_with_the_apps_role_and_radius(self):
        t = text("[100.00, 100.00],[130.00, 56.00]", "Title", [run(0, 5, 10.0, 10.0, 33.0, 25.0)], id="px:button:Title", backgroundColor="#FFF4F0F1", borderRadius="12.00vp")
        els = export(column([t], rect="[0.00, 0.00],[1920.00, 1080.00]"), "x", "dark", (1920, 1080, 1))["elements"]
        self.assertEqual([(e["role"], e["text"], e.get("radius")) for e in els if e["role"] != "container"], [("button", "Title", 12.0)])

    def test_a_control_fully_behind_a_later_drawer_is_dropped(self):
        btn = {"$type": "Row", "$rect": "[1846.00, 151.00],[62.00, 72.00]", "$attrs": {"id": "px:button:Filters", "backgroundColor": "#33FFFFFF"}, "$children": []}
        drawer = {"$type": "Column", "$rect": "[1560.00, 0.00],[360.00, 1080.00]", "$attrs": {"id": "px:dialog:Filters", "backgroundColor": "#F0211D21"}, "$children": []}
        doc = export(column([btn, drawer], rect="[0.00, 0.00],[1920.00, 1080.00]"), "x", "dark", (1920, 1080, 1))
        self.assertEqual([e["role"] for e in doc["elements"]], ["container", "dialog"])
        self.assertEqual(doc["occluded"], 1)

    def test_a_partly_covered_control_stays(self):
        btn = {"$type": "Row", "$rect": "[1500.00, 151.00],[100.00, 72.00]", "$attrs": {"id": "px:button:Filters", "backgroundColor": "#33FFFFFF"}, "$children": []}
        drawer = {"$type": "Column", "$rect": "[1560.00, 0.00],[360.00, 1080.00]", "$attrs": {"backgroundColor": "#F0211D21"}, "$children": []}
        doc = export(column([btn, drawer], rect="[0.00, 0.00],[1920.00, 1080.00]"), "x", "dark", (1920, 1080, 1))
        self.assertIn("button", [e["role"] for e in doc["elements"]])


if __name__ == "__main__":
    unittest.main()
