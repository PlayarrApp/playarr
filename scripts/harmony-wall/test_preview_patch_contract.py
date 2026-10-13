import unittest
from pathlib import Path


HERE = Path(__file__).resolve().parent


class PreviewPatchContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.patch_state = (HERE / "patch_state.py").read_text(encoding="utf-8")
        cls.patch_rail = (HERE / "patch_rail.py").read_text(encoding="utf-8")
        cls.preview_state = (HERE / "overlay/src/main/ets/util/PreviewState.ets").read_text(encoding="utf-8")

    def test_preview_reporting_uses_scalar_props_and_no_function_props(self):
        card_transform = self.patch_state.split("def card(s):", 1)[1].split("\ndef nav(s):", 1)[0]
        detail_transform = self.patch_state.split("def detail(s):", 1)[1].split("\ndef card_dbg(s):", 1)[0]
        props = (
            "@Prop previewRoute: string = ''",
            "@Prop previewWorkId: string = ''",
            "@Prop previewRowId: string = ''",
            "@Prop previewGeneration: number = 0",
        )
        for expected in props:
            self.assertIn(expected, card_transform)
        self.assertIn("reportDetailRowImageStageForScope(this.previewRoute, this.previewWorkId, this.previewRowId, this.previewGeneration, 'on-complete')", card_transform)
        self.assertIn("reportDetailLayoutStageForScope(this.previewRoute, this.previewWorkId, this.previewGeneration, 'poster-card-root-area'", card_transform)
        self.assertIn("previewRowId: (item as DetailRow).id", detail_transform)
        self.assertIn("previewGeneration: currentPreviewRouteGeneration()", detail_transform)
        self.assertIn("private tvRightColumn(): void", detail_transform)
        self.assertIn("previewWorkId: this.workId", detail_transform)
        self.assertIn("reportDetailLayoutStageForScope('Detail', this.workId, currentPreviewRouteGeneration(), 'detail-rails-count'", detail_transform)
        self.assertLess(detail_transform.index("this.rails = rails;"),
                        detail_transform.index("'detail-rails-count', rails.length"))
        self.assertLess(self.patch_rail.index(".height(this.listHeight > 0 ? this.listHeight : '100%')"),
                        self.patch_rail.index(".onAppear(() => {"))
        self.assertIn("reportDetailLayoutStageForScope(this.previewRoute, this.previewWorkId, this.previewGeneration, 'rail-items-count'", self.patch_rail)
        self.assertIn("rail-items-count", self.patch_rail)
        self.assertIn("rail-item-appear", self.patch_rail)
        self.assertIn("ListItem()", self.patch_rail)
        self.assertIn(".onAppear(() => { reportDetailLayoutStageForScope(this.previewRoute, this.previewWorkId, this.previewGeneration, 'rail-item-appear'", self.patch_rail)
        self.assertIn("rail-list-area", self.patch_rail)
        self.assertIn("rail-list-height-default-fill", self.patch_rail)
        self.assertNotIn("@Prop onPreview", card_transform + self.patch_rail)
        self.assertNotRegex(card_transform + self.patch_rail, r"@Prop\s+\w+\s*:\s*\([^\n]*=>")

    def test_preview_scope_generation_is_captured_as_scalar_props(self):
        self.assertIn("previewGeneration: currentPreviewRouteGeneration()", self.patch_state)
        self.assertIn("export function currentPreviewRouteGeneration(): number", self.preview_state)
        self.assertIn("generation !== PREVIEW_ROUTE_GENERATION", self.preview_state)
        self.assertIn("return new DetailRowImageContext(PREVIEW_ROUTE, parentWorkId, rowId, PREVIEW_ROUTE_GENERATION);", self.preview_state)


if __name__ == "__main__":
    unittest.main()
