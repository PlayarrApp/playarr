import unittest
from layout_export import ExportError, export


def column(children, rect="[0.00, 0.00],[1080.00, 2340.00]", fill="#FF151315", **attrs):
    return {"$type": "Column", "$rect": rect, "$attrs": dict({"backgroundColor": fill}, **attrs), "$children": children}


def text(rect, content, measured, **attrs):
    node = {"$type": "Text", "$rect": rect, "$attrs": dict({"content": content, "fontSize": "16.00fp", "fontFamily": "NunitoSansW610", "fontColor": "#FFF4F0F1"}, **attrs)}
    if measured is not None:
        node["$measured"] = measured
    return node


class LayoutExportTest(unittest.TestCase):
    def test_text_rect_is_the_measured_line_centred_in_the_box(self):
        tree = column([text("[30.00, 300.00],[970.00, 72.00]", "Hello  world", [{"text": "Hello  world", "w": 300.0, "h": 66.0, "lineH": 66.0}])])
        doc = export(tree, "x", "dark", (360, 780, 3))
        t = [e for e in doc["elements"] if e["role"] == "text"][0]
        self.assertEqual(t["text"], "Hello world")
        self.assertEqual(t["fontWeight"], 610)
        # the baseline ArkUI draws on (0.821 of the 66 px line below its top), with the font file's own ascent 1.011 and descent 0.353 around it
        self.assertEqual(t["rect"], {"x": 10.0, "y": 102.89, "w": 100.0, "h": 21.82})
        self.assertEqual(t["color"], "#f4f0f1")
        self.assertEqual(t["background"], "#151315")

    def test_a_wrapped_text_exports_one_element_per_measured_line(self):
        lines = [{"text": "one two", "w": 90.0, "h": 20.0, "lineH": 24.0}, {"text": "three", "w": 50.0, "h": 20.0, "lineH": 24.0}]
        tree = column([text("[0.00, 0.00],[200.00, 48.00]", "one two three", lines)], rect="[0.00, 0.00],[1920.00, 1080.00]")
        doc = export(tree, "x", "dark", (1920, 1080, 1))
        t = [e for e in doc["elements"] if e["role"] == "text"]
        self.assertEqual([e["text"] for e in t], ["one two", "three"])  # web's refs hold one element per rendered line
        self.assertEqual([round(e["rect"]["y"] - t[0]["rect"]["y"], 2) for e in t], [0.0, 24.0])  # one line pitch apart

    def test_the_inspector_box_already_holds_the_scale_so_only_the_text_metrics_are_scaled(self):
        lines = [{"text": "Movies", "w": 30.0, "h": 10.0, "lineH": 10.0}]
        inner = text("[10.00, 10.00],[31.50, 10.50]", "Movies", lines)
        tile = {"$type": "Column", "$rect": "[0.00, 0.00],[67.20, 67.20]", "$attrs": {"id": "px:link:Movies", "backgroundColor": "#17F4F0F1", "scale": {"x": "1.050000", "y": "1.050000"}}, "$children": [inner]}
        doc = export(column([tile], rect="[0.00, 0.00],[1920.00, 1080.00]"), "x", "dark", (1920, 1080, 1))
        link = [e for e in doc["elements"] if e["role"] == "link"][0]
        self.assertEqual((link["rect"]["w"], link["rect"]["h"]), (67.2, 67.2))  # as reported, not 70.56
        t = [e for e in doc["elements"] if e["role"] == "text"][0]
        self.assertEqual(t["rect"]["w"], 31.5)  # 30 px measured, drawn at 1.05

    def test_a_text_without_a_native_measurement_fails_the_export(self):
        tree = column([text("[0.00, 0.00],[200.00, 48.00]", "unmeasured", None)], rect="[0.00, 0.00],[1920.00, 1080.00]")
        with self.assertRaises(ExportError):
            export(tree, "x", "dark", (1920, 1080, 1))

    def test_nothing_is_synthesised_for_an_empty_tree(self):
        doc = export(column([]), "player-controls", "dark", (1920, 1080, 1))
        self.assertEqual([e["role"] for e in doc["elements"]], ["container"])  # only the app's own root fill

    def test_controls_use_the_apps_accessible_name_and_box(self):
        tree = column([{"$type": "Row", "$rect": "[100.00, 100.00],[64.00, 64.00]", "$attrs": {"id": "px:button:Play", "backgroundColor": "#33FFFFFF", "borderRadius": "32.00vp"}, "$children": []}],
                      rect="[0.00, 0.00],[1920.00, 1080.00]")
        doc = export(tree, "x", "dark", (1920, 1080, 1))
        b = [e for e in doc["elements"] if e["role"] == "button"][0]
        self.assertEqual((b["text"], b["rect"]["w"], b["radius"]), ("Play", 64.0, 32.0))


if __name__ == "__main__":
    unittest.main()
