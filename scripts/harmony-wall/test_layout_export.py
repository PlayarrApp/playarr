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

    def test_a_wrapped_text_exports_one_element_per_line(self):
        runs = [run(0, 8, 0.0, 0.0, 90.0, 20.0), run(8, 13, 0.0, 24.0, 50.0, 44.0)]
        tree = column([text("[0.00, 0.00],[200.00, 48.00]", "one two three", runs)], rect="[0.00, 0.00],[1920.00, 1080.00]")
        t = [e for e in export(tree, "x", "dark", (1920, 1080, 1))["elements"] if e["role"] == "text"]
        self.assertEqual([e["text"] for e in t], ["one two", "three"])
        self.assertEqual([round(e["rect"]["y"] - t[0]["rect"]["y"], 2) for e in t], [0.0, 24.0])

    def test_the_inspector_box_already_holds_the_scale_so_only_the_text_is_scaled(self):
        inner = text("[10.00, 10.00],[31.50, 10.50]", "Movies", [run(0, 6, 0.0, 0.0, 30.0, 10.0)])
        tile = {"$type": "Column", "$rect": "[0.00, 0.00],[67.20, 67.20]", "$attrs": {"accessibilityText": "Movies", "accessibilityTextHint": "pvrole:39", "backgroundColor": "#17F4F0F1", "scale": {"x": "1.050000", "y": "1.050000"}}, "$children": [inner]}
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
        tree = column([{"$type": "Row", "$rect": "[100.00, 100.00],[64.00, 64.00]", "$attrs": {"accessibilityText": "Play", "accessibilityTextHint": "pvrole:5", "backgroundColor": "#33FFFFFF", "borderRadius": "32.00vp"}, "$children": []}],
                      rect="[0.00, 0.00],[1920.00, 1080.00]")
        b = [e for e in export(tree, "x", "dark", (1920, 1080, 1))["elements"] if e["role"] == "button"][0]
        self.assertEqual((b["text"], b["rect"]["w"], b["radius"]), ("Play", 64.0, 32.0))

    def test_a_text_that_draws_a_control_box_exports_the_box_and_its_runs(self):
        t = text("[100.00, 100.00],[130.00, 56.00]", "Title", [run(0, 5, 10.0, 10.0, 33.0, 25.0)], accessibilityText="Title", accessibilityTextHint="pvrole:5", backgroundColor="#FFF4F0F1", borderRadius="12.00vp")
        els = export(column([t], rect="[0.00, 0.00],[1920.00, 1080.00]"), "x", "dark", (1920, 1080, 1))["elements"]
        self.assertEqual([(e["role"], e["text"], e.get("radius")) for e in els if e["role"] != "container"], [("button", "Title", 12.0), ("text", "Title", None)])

    def test_a_text_control_without_a_fill_still_gets_its_box_and_runs(self):
        t = text("[100.00, 100.00],[130.00, 56.00]", "Title", [run(0, 5, 10.0, 10.0, 33.0, 25.0)], accessibilityTextHint="pvrole:5")
        els = export(column([t], rect="[0.00, 0.00],[1920.00, 1080.00]"), "x", "dark", (1920, 1080, 1))["elements"]
        self.assertEqual([(e["role"], e["text"]) for e in els if e["role"] != "container"], [("button", "Title"), ("text", "Title")])

    def test_text_height_is_the_native_range_height(self):
        t = text("[0.00, 0.00],[200.00, 48.00]", "Hi", [run(0, 2, 0.0, 4.0, 20.0, 19.0)])
        e = [e for e in export(column([t], rect="[0.00, 0.00],[1920.00, 1080.00]"), "x", "dark", (1920, 1080, 1))["elements"] if e["role"] == "text"][0]
        self.assertEqual((e["rect"]["y"], e["rect"]["h"]), (4.0, 15.0))

    def test_a_control_fully_behind_a_later_drawer_is_dropped(self):
        btn = {"$type": "Row", "$rect": "[1846.00, 151.00],[62.00, 72.00]", "$attrs": {"accessibilityText": "Filters", "accessibilityTextHint": "pvrole:5", "backgroundColor": "#33FFFFFF"}, "$children": []}
        drawer = {"$type": "Column", "$rect": "[1560.00, 0.00],[360.00, 1080.00]", "$attrs": {"accessibilityTextHint": "pvrole:24", "backgroundColor": "#F0211D21"}, "$children": []}
        doc = export(column([btn, drawer], rect="[0.00, 0.00],[1920.00, 1080.00]"), "x", "dark", (1920, 1080, 1))
        self.assertEqual([e["role"] for e in doc["elements"]], ["container", "dialog"])
        self.assertEqual(doc["occluded"], 1)

    def test_a_partly_covered_control_stays(self):
        btn = {"$type": "Row", "$rect": "[1500.00, 151.00],[100.00, 72.00]", "$attrs": {"accessibilityText": "Filters", "accessibilityTextHint": "pvrole:5", "backgroundColor": "#33FFFFFF"}, "$children": []}
        drawer = {"$type": "Column", "$rect": "[1560.00, 0.00],[360.00, 1080.00]", "$attrs": {"backgroundColor": "#F0211D21"}, "$children": []}
        doc = export(column([btn, drawer], rect="[0.00, 0.00],[1920.00, 1080.00]"), "x", "dark", (1920, 1080, 1))
        self.assertIn("button", [e["role"] for e in doc["elements"]])

    def test_a_mask_layer_neither_exports_nor_hides_what_is_under_it(self):
        label = text("[100.00, 100.00],[200.00, 30.00]", "Hi", [run(0, 2, 0.0, 0.0, 20.0, 20.0)])
        mask = {"$type": "Column", "$rect": "[0.00, 0.00],[1920.00, 1080.00]", "$attrs": {"blendMode": 7, "backgroundColor": "#FF000000"}, "$children": []}
        doc = export(column([label, mask], rect="[0.00, 0.00],[1920.00, 1080.00]"), "x", "dark", (1920, 1080, 1))
        self.assertEqual([e["role"] for e in doc["elements"]], ["container", "text"])


    def test_a_box_clamped_by_the_window_takes_the_frames_measured_size_or_fails(self):
        card = {"$type": "Row", "$rect": "[1174.00, 100.00],[626.00, 200.00]", "$attrs": {"accessibilityText": "Card", "accessibilityTextHint": "pvrole:5", "backgroundColor": "#FF201C20"}}
        tree = column([card], rect="[0.00, 0.00],[1800.00, 3600.00]")
        tree["width"], tree["height"] = 1800.0, 3600.0
        with self.assertRaises(ExportError):
            export(tree, "x", "dark", (600, 1200, 3))
        card["$frame"] = {"w": 885.0, "h": 200.0}
        doc = export(tree, "x", "dark", (600, 1200, 3))
        self.assertEqual([e["rect"]["w"] for e in doc["elements"] if e["role"] == "button"], [295.0])

    def test_a_text_truncated_by_the_frameworks_ellipsis_fails_the_export(self):
        node = text("[0.00, 0.00],[204.00, 51.00]", "Hollow Garden 3", [run(0, 7, 0.0, 3.0, 128.0, 47.0)], textOverflow="TextOverflow.Ellipsis")
        with self.assertRaises(ExportError):
            export(column([node], rect="[0.00, 0.00],[1920.00, 1080.00]"), "x", "dark", (1920, 1080, 1))
        node["$runs"] = [run(0, 15, 0.0, 3.0, 128.0, 47.0)]
        export(column([node], rect="[0.00, 0.00],[1920.00, 1080.00]"), "x", "dark", (1920, 1080, 1))

    def test_a_text_that_paints_a_pill_keeps_its_radius(self):
        pill = text("[10.00, 10.00],[70.00, 27.00]", "Missing", [run(0, 7, 5.0, 4.0, 60.0, 22.0)], backgroundColor="#FF392C30", borderRadius="13.50vp")
        doc = export(column([pill], rect="[0.00, 0.00],[1920.00, 1080.00]"), "x", "dark", (1920, 1080, 1))
        self.assertEqual([e["radius"] for e in doc["elements"] if e["role"] in ("text", "container") and e["rect"]["w"] < 100], [13.5, 13.5])

    # occlusion contract: the audit's probes and the painter rules
    def _button(self):
        return {"$type": "Button", "$rect": "[100.00, 100.00],[300.00, 120.00]", "$attrs": {"accessibilityText": "Quality"}}

    def _roles(self, children):
        return [e["role"] for e in export(column(children), "x", "dark", (360, 780, 3))["elements"]]

    def test_a_hit_test_none_row_does_not_drop_the_button_under_it(self):
        cover = {"$type": "Row", "$rect": "[0.00, 0.00],[1080.00, 2340.00]", "$attrs": {"backgroundColor": "#FF000000", "hitTestBehavior": "HitTestMode.None"}, "$children": []}
        self.assertIn("button", self._roles([self._button(), cover]))
        cover["$attrs"]["hitTestBehavior"] = "HitTestMode.Default"
        self.assertNotIn("button", self._roles([self._button(), cover]))

    def test_an_unpainted_text_control_covers_nothing_but_its_glyphs(self):
        # audit counterexample 1: a role=button Text over the button with no fill and one glyph range far from it
        btn = {"$type": "Button", "$rect": "[30.00, 30.00],[60.00, 60.00]", "$attrs": {"accessibilityText": "Under"}}
        far = text("[0.00, 0.00],[300.00, 300.00]", "x", [run(0, 1, 210.0, 210.0, 240.0, 240.0)], accessibilityTextHint="pvrole:5", accessibilityText="Cover")
        self.assertIn("Under", [e["text"] for e in export(column([btn, far]), "x", "dark", (360, 780, 3))["elements"]])
        far["$attrs"]["opacity"] = "0.2"
        self.assertIn("Under", [e["text"] for e in export(column([btn, far]), "x", "dark", (360, 780, 3))["elements"]])

    def test_a_round_painter_does_not_cover_beyond_its_circle(self):
        # audit counterexample 2: a 100 x 100 black component with radius 50 does not reach the corner of the button at (0, 0)
        btn = {"$type": "Button", "$rect": "[0.00, 0.00],[30.00, 30.00]", "$attrs": {"accessibilityText": "Corner"}}
        disc = {"$type": "Row", "$rect": "[0.00, 0.00],[300.00, 300.00]", "$attrs": {"backgroundColor": "#FF000000", "borderRadius": "50.00vp"}, "$children": []}
        self.assertIn("button", [e["role"] for e in export(column([btn, disc]), "x", "dark", (360, 780, 3))["elements"]])
        disc["$attrs"]["borderRadius"] = "0.00vp"
        self.assertNotIn("button", [e["role"] for e in export(column([btn, disc]), "x", "dark", (360, 780, 3))["elements"]])

    def test_a_clipped_gradient_keeps_the_alpha_of_its_whole_box(self):
        # audit counterexample 3: a gradient 200 tall whose top half is clipped away; alpha at the button rows is that of the whole box
        scroll = {"$type": "Scroll", "$rect": "[0.00, 0.00],[300.00, 300.00]", "$attrs": {}, "$children": [{"$type": "Column", "$rect": "[0.00, -300.00],[300.00, 600.00]",
                  "$attrs": {"linearGradient": {"angle": "180.00px", "direction": "GradientDirection.None", "repeating": "false", "colors": [["#00000000", "0.000000"], ["#FF000000", "1.000000"]]}}, "$children": []}]}
        low = {"$type": "Button", "$rect": "[30.00, 30.00],[60.00, 60.00]", "$attrs": {"accessibilityText": "Low"}}
        # whole-box alpha at y 30..90 is 0.55..0.65 (covered); a gradient re-fitted to the clip would give 0.1..0.3 (kept)
        self.assertNotIn("button", [e["role"] for e in export(column([low, scroll]), "x", "dark", (360, 780, 3))["elements"]])

    def test_a_recovered_frame_size_is_scaled_like_the_box(self):
        # audit: window 300 px, scale 2, inspector rect (240, 10, 60, 20) cut at the edge, measured pre-transform size (50, 10) is 100 wide
        tile = {"$type": "Column", "$rect": "[240.00, 10.00],[60.00, 20.00]", "$attrs": {"accessibilityText": "Tile", "accessibilityTextHint": "pvrole:5", "scale": {"x": "2.000000", "y": "2.000000"}},
                "$frame": {"w": 50.0, "h": 10.0}, "$children": []}
        root = column([tile], rect="[0.00, 0.00],[300.00, 600.00]")
        root["width"], root["height"] = 300, 600
        doc = export(root, "x", "dark", (100, 200, 3))
        self.assertEqual([e["rect"]["w"] for e in doc["elements"] if e["role"] == "button"], [round(100 / 3, 2)])

    def test_glyph_ranges_inside_the_viewport_survive_an_offstage_frame(self):
        t = text("[330.00, 100.00],[30.00, 40.00]", "ab", [run(0, 2, -90.0, 0.0, 0.0, 30.0)])
        doc = export(column([t]), "x", "dark", (100, 200, 3))
        self.assertEqual([e["text"] for e in doc["elements"] if e["role"] == "text"], ["ab"])

    def test_transparent_text_is_not_exported_and_a_missing_style_raises(self):
        t = text("[30.00, 100.00],[90.00, 40.00]", "ab", [run(0, 2, 0.0, 0.0, 60.0, 30.0)], fontColor="#00F4F0F1")
        self.assertEqual([e for e in export(column([t]), "x", "dark", (360, 780, 3))["elements"] if e["role"] == "text"], [])
        t2 = text("[30.00, 100.00],[90.00, 40.00]", "ab", [run(0, 2, 0.0, 0.0, 60.0, 30.0)])
        del t2["$attrs"]["fontSize"]
        with self.assertRaises(ExportError):
            export(column([t2]), "x", "dark", (360, 780, 3))

    def test_an_ellipsis_cut_only_fails_when_a_cut_line_is_visible(self):
        cut = text("[330.00, 100.00],[30.00, 40.00]", "abcdef", [run(0, 3, 0.0, 0.0, 30.0, 30.0)], textOverflow="TextOverflow.Ellipsis")
        self.assertEqual([e for e in export(column([cut]), "x", "dark", (100, 200, 3))["elements"] if e["role"] == "text"], [])  # offstage: nothing to refuse
        cut["$rect"] = "[30.00, 100.00],[30.00, 40.00]"
        with self.assertRaises(ExportError):
            export(column([cut]), "x", "dark", (100, 200, 3))

    def test_a_divider_is_exported_with_its_stroke_colour(self):
        d = {"$type": "Divider", "$rect": "[100.00, 400.00],[600.00, 1.00]", "$attrs": {"color": "#15F4F0F1", "strokeWidth": "1.00vp", "backgroundColor": "#00000000"}}
        doc = export(column([d]), "x", "dark", (1920, 1080, 1))
        rules = [e for e in doc["elements"] if e["rect"]["h"] == 1.0]
        self.assertEqual(len(rules), 1)
        self.assertNotEqual(rules[0]["background"], "#151315")

    def test_a_painted_text_with_a_background_covers(self):
        cover = text("[0.00, 0.00],[1080.00, 2340.00]", "", [], backgroundColor="#FF000000")
        self.assertNotIn("button", self._roles([self._button(), cover]))

    def test_z_index_decides_paint_order(self):
        cover = {"$type": "Row", "$rect": "[0.00, 0.00],[1080.00, 2340.00]", "$attrs": {"backgroundColor": "#FF000000"}, "$children": []}
        self.assertNotIn("button", self._roles([self._button(), cover]))  # listed after the button: paints over it
        cover["$attrs"]["zIndex"] = "-1"
        self.assertIn("button", self._roles([self._button(), cover]))  # a lower zIndex paints under it although listed later

    def test_image_opacity_counts(self):
        img = {"$type": "Image", "$rect": "[0.00, 0.00],[1080.00, 2340.00]", "$attrs": {"opacity": "0.2"}}
        self.assertIn("button", self._roles([self._button(), img]))
        img["$attrs"]["opacity"] = "1"
        self.assertNotIn("button", self._roles([self._button(), img]))

    def test_a_gradient_covers_only_where_it_is_opaque(self):
        grad = {"$type": "Column", "$rect": "[0.00, 0.00],[1080.00, 2340.00]", "$attrs": {"linearGradient": {"angle": "0.00px", "direction": "GradientDirection.None", "repeating": "false",
                "colors": [["#FF000000", "0.000000"], ["#FF000000", "0.340000"], ["#00000000", "0.680000"], ["#00000000", "1.000000"]]}}, "$children": []}
        # angle 0 points up: the opaque end is at the bottom, so a button near the top is not covered, one near the bottom is
        self.assertIn("button", self._roles([self._button(), grad]))
        low = {"$type": "Button", "$rect": "[100.00, 2100.00],[300.00, 120.00]", "$attrs": {"accessibilityText": "Low"}}
        self.assertNotIn("button", self._roles([low, grad]))

    def test_a_spinner_and_a_surface_are_exported_and_limits_are_stated(self):
        spin = {"$type": "LoadingProgress", "$rect": "[500.00, 1000.00],[90.00, 90.00]", "$attrs": {}}
        surf = {"$type": "XComponent", "$rect": "[0.00, 0.00],[1080.00, 600.00]", "$attrs": {"content": "Preview not available for this component."}}
        doc = export(column([surf, spin]), "x", "dark", (360, 780, 3))
        self.assertEqual([e["role"] for e in doc["elements"] if e["role"] in ("image", "video")].count("image"), 1)
        self.assertIn("video", [e["role"] for e in doc["elements"]])
        self.assertTrue(any("placeholder text" in l for l in doc["limits"]))


if __name__ == "__main__":
    unittest.main()
