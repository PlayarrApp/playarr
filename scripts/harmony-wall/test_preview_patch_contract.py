import unittest
from pathlib import Path


HERE = Path(__file__).resolve().parent


class PreviewPatchContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.patch_state = (HERE / "patch_state.py").read_text(encoding="utf-8")
        cls.patch_rail = (HERE / "patch_rail.py").read_text(encoding="utf-8")
        cls.preview_state = (HERE / "overlay/src/main/ets/util/PreviewState.ets").read_text(encoding="utf-8")
        cls.detail_source = (HERE.parents[1] / "clients/harmony/entry/src/main/ets/pages/Detail.ets").read_text(encoding="utf-8")

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
        self.assertIn("@Prop @Watch('previewArtworkUpdated') artwork: image.PixelMap | undefined = undefined", card_transform)
        self.assertLess(card_transform.index("@Prop previewRoute"),
                        card_transform.index("@Prop @Watch('previewArtworkUpdated') artwork"))
        self.assertIn("'poster-artwork-prop-undefined' : 'poster-artwork-prop-present'", card_transform)
        self.assertIn("'poster-render-artwork-present'", card_transform)
        self.assertIn("'poster-render-artwork-undefined'", card_transform)
        self.assertIn("reportDetailLayoutStageForScope(this.previewRoute, this.previewWorkId, this.previewGeneration, 'poster-card-root-area'", card_transform)
        self.assertIn("previewRowId: (item as DetailRow).id", detail_transform)
        self.assertIn("import { PosterCard } from '../design/components/PosterCard';\\nimport { currentPreviewRouteGeneration", detail_transform)
        self.assertIn("previewGeneration: currentPreviewRouteGeneration()", detail_transform)
        self.assertIn("private tvRightColumn(): void", detail_transform)
        self.assertIn("previewWorkId: this.workId", detail_transform)
        self.assertIn("reportDetailLayoutStageForScope('Detail', this.workId, currentPreviewRouteGeneration(), 'detail-rails-count'", detail_transform)
        self.assertIn("matchingRowCount > 0 ? 'row-match-found' : 'row-match-missing'", detail_transform)
        self.assertIn("updatedRow as DetailRow).artworkState.pixelMap !== undefined", detail_transform)
        self.assertIn("assignedArtworkState ? 'artwork-state-present' : 'artwork-state-absent'", detail_transform)
        self.assertIn("reportDetailRowImageStage(previewContext, 'artwork-state-mutated')", detail_transform)
        self.assertIn("reportDetailRowImageStage(previewContext,", detail_transform)
        row_update = detail_transform.split('new = """', 1)[1].split('"""', 1)[0]
        self.assertLess(row_update.index("'row-match-found'"),
                        row_update.index("this.rails = applyRowArtworkAcrossRails"))
        self.assertLess(detail_transform.index("this.rails = rails;"),
                        detail_transform.index("'detail-rails-count', rails.length"))
        self.assertLess(self.patch_rail.index(".height(this.listHeight > 0 ? this.listHeight : '100%')"),
                        self.patch_rail.index(".onAppear(() => {"))
        self.assertIn("reportDetailLayoutStageForScope(this.previewRoute, this.previewWorkId, this.previewGeneration, 'rail-items-count'", self.patch_rail)
        self.assertIn("rail-items-count", self.patch_rail)
        self.assertIn("rail-item-appear", self.patch_rail)
        self.assertIn("ListItem()", self.patch_rail)
        self.assertIn("reportDetailLayoutStageForScope(this.previewRoute, this.previewWorkId, this.previewGeneration, 'rail-item-appear'", self.patch_rail)
        self.assertIn("artworkState !== undefined && artworkState.pixelMap !== undefined", self.patch_rail)
        self.assertIn("'visible-item-artwork-state-present' : 'visible-item-artwork-state-absent'", self.patch_rail)
        self.assertIn("reportDetailRowImageStageForScope(this.previewRoute, this.previewWorkId, item.id, this.previewGeneration", self.patch_rail)
        self.assertIn("@Prop @Watch('previewItemsUpdated') items: MediaRailItem[] = []", self.patch_rail)
        self.assertIn("s = s.replace(plain, preview_prop + watched_prop", self.patch_rail)
        self.assertIn("s = s.replace(prop, preview_prop + watched_prop", self.patch_rail)
        self.assertIn("'rail-items-prop-update-count', this.items.length", self.patch_rail)
        self.assertIn("'rail-items-prop-update-artwork-count', artworkCount", self.patch_rail)
        self.assertIn("if (this.previewRoute !== 'Detail' || this.previewWorkId.length === 0)", self.patch_rail)
        self.assertLess(self.patch_rail.index("if (this.previewRoute !== 'Detail' || this.previewWorkId.length === 0)"),
                        self.patch_rail.index("for (const item of this.items)"))
        self.assertIn("artworkState?: PreviewMediaRailArtworkStateView", self.patch_rail)
        self.assertIn("artworkState !== undefined && artworkState.pixelMap !== undefined", self.patch_rail)
        list_item_transform = self.patch_rail.split("s = s.replace(builder,", 1)[1]
        self.assertIn("if (this.previewRoute === 'Detail' && this.previewWorkId.length > 0)", list_item_transform)
        self.assertLess(list_item_transform.index("if (this.previewRoute === 'Detail' && this.previewWorkId.length > 0)"),
                        list_item_transform.index("const previewItem = item as PreviewMediaRailArtworkCountItem"))
        self.assertIn("artworkState !== undefined && artworkState.pixelMap !== undefined", list_item_transform)
        self.assertIn("? 'visible-item-artwork-state-present' : 'visible-item-artwork-state-absent'", list_item_transform)
        self.assertIn("interface PreviewMediaRailArtworkStateView", self.patch_rail)
        self.assertNotIn("previewItem.artwork !==", self.patch_rail)
        self.assertIn("reportDetailLayoutStageForScope(this.previewRoute, this.previewWorkId, this.previewGeneration", self.patch_rail)
        self.assertNotRegex(self.patch_rail, r"@Prop\s+\w+\s*:\s*\([^\n]*=>")
        self.assertIn("rail-list-area", self.patch_rail)
        self.assertIn("rail-list-height-default-fill", self.patch_rail)
        self.assertNotIn("@Prop onPreview", card_transform + self.patch_rail)
        self.assertNotRegex(card_transform + self.patch_rail, r"@Prop\s+\w+\s*:\s*\([^\n]*=>")


    def test_observed_detail_artwork_state_is_the_instrumented_builder_source(self):
        self.assertIn("@Observed\nclass DetailArtworkState", self.detail_source)
        self.assertIn("@ObjectLink artworkState: DetailArtworkState", self.detail_source)
        self.assertIn("this.cardBuilder(this.artworkState.pixelMap)", self.detail_source)
        self.assertIn("artworkState: item.artworkState", self.detail_source)
        self.assertIn("item.artworkState.pixelMap = artwork", self.detail_source)
        self.assertIn("DetailRowArtworkCard({\n        artworkState: (item as DetailRow).artworkState,\n        cardBuilder:", self.detail_source)
        self.assertIn("previewRowId: (item as DetailRow).id", self.patch_state)
        self.assertIn("artworkState.pixelMap !== undefined", self.patch_state)
        self.assertNotIn("visible-item-stamp-", self.patch_rail + self.patch_state)

    def test_preview_scope_generation_is_captured_as_scalar_props(self):
        self.assertIn("previewGeneration: currentPreviewRouteGeneration()", self.patch_state)
        self.assertIn("export function currentPreviewRouteGeneration(): number", self.preview_state)
        self.assertIn("generation !== PREVIEW_ROUTE_GENERATION", self.preview_state)
        self.assertIn("return new DetailRowImageContext(PREVIEW_ROUTE, parentWorkId, rowId, PREVIEW_ROUTE_GENERATION);", self.preview_state)


if __name__ == "__main__":
    unittest.main()
