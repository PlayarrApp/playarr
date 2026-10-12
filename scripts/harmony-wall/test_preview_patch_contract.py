import unittest
from pathlib import Path


HERE = Path(__file__).resolve().parent


class PreviewPatchContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.patch_state = (HERE / "patch_state.py").read_text(encoding="utf-8")
        cls.patch_rail = (HERE / "patch_rail.py").read_text(encoding="utf-8")
        cls.preview_state = (HERE / "overlay/src/main/ets/util/PreviewState.ets").read_text(encoding="utf-8")

    def test_detail_callback_props_are_reactive_and_passed_on_child_updates(self):
        card_transform = self.patch_state.split("def card(s):", 1)[1].split("\ndef nav(s):", 1)[0]
        detail_transform = self.patch_state.split("def detail(s):", 1)[1].split("\ndef card_dbg(s):", 1)[0]
        props = (
            "@Prop onPreviewRowImageSource: () => void",
            "@Prop onPreviewRowImageArea: (positive: boolean) => void",
            "@Prop onPreviewRowImageComplete: () => void",
            "@Prop onPreviewRowImageError: () => void",
            "@Prop onPreviewLayout: (stage: string, value: number, width: number, height: number)",
        )
        callbacks = (
            "onPreviewRowImageSource: createDetailRowImageStageCallback(this.workId, (item as DetailRow).id, 'image-source')",
            "onPreviewRowImageArea: createDetailRowImageAreaCallback(this.workId, (item as DetailRow).id)",
            "onPreviewRowImageComplete: createDetailRowImageStageCallback(this.workId, (item as DetailRow).id, 'on-complete')",
            "onPreviewRowImageError: createDetailRowImageStageCallback(this.workId, (item as DetailRow).id, 'on-error')",
        )
        for expected in props:
            self.assertIn(expected, card_transform)
        for expected in callbacks:
            self.assertIn(expected, detail_transform)
        self.assertIn("onPreviewLayout: createDetailLayoutCallback(this.workId)", detail_transform)
        self.assertIn("private tvRightColumn(): void", detail_transform)
        self.assertIn("reportDetailLayoutStage(layoutContext, 'detail-rails-count', rails.length, -1, -1)", detail_transform)
        self.assertLess(detail_transform.index("this.rails = rails;"),
                        detail_transform.index("'detail-rails-count', rails.length"))
        self.assertNotIn("const previewLayout =", detail_transform)
        self.assertLess(self.patch_rail.index(".height(this.listHeight > 0 ? this.listHeight : '100%')"),
                        self.patch_rail.index(".onAppear(() => {"))
        self.assertIn("this.onPreviewLayout('rail-items-count', this.items.length", self.patch_rail)
        self.assertIn("rail-items-count", self.patch_rail)
        self.assertIn("rail-item-appear", self.patch_rail)
        self.assertIn("ListItem()", self.patch_rail)
        self.assertIn(".onAppear(() => { this.onPreviewLayout('rail-item-appear', 1, -1, -1); })", self.patch_rail)
        self.assertNotIn("this.onPreviewLayout('rail-item-builder'", self.patch_rail)
        self.assertIn("rail-list-area", self.patch_rail)
        self.assertIn("rail-list-height-default-fill", self.patch_rail)

    def test_callback_context_is_captured_when_the_detail_callback_is_constructed(self):
        helper = self.patch_state.split("function createDetailRowImageStageCallback", 1)[1].split("// -- UI-only constants", 1)[0]
        self.assertIn("const context = captureDetailRowImageContext(parentWorkId, rowId);", helper)
        self.assertIn("return (): void => { reportDetailRowImageStage(context, stage); };", helper)
        self.assertIn("return (positive: boolean): void => {", helper)
        self.assertIn("reportDetailRowImageStage(context, positive ? 'image-area-positive' : 'image-area-zero');", helper)
        self.assertIn("const context = captureDetailLayoutContext(parentWorkId);", helper)
        self.assertIn("reportDetailLayoutStage(context, stage, value, width, height);", helper)
        self.assertIn("return new DetailLayoutContext(PREVIEW_ROUTE, workId, PREVIEW_ROUTE_GENERATION);", self.preview_state)
        self.assertIn("return new DetailRowImageContext(PREVIEW_ROUTE, parentWorkId, rowId, PREVIEW_ROUTE_GENERATION);", self.preview_state)
        self.assertNotIn("captureDetailRowImageContext(parentWorkId, rowId);\n  return (): void => {\n    const", helper)


if __name__ == "__main__":
    unittest.main()
