import unittest
from pathlib import Path
import importlib.util


HERE = Path(__file__).resolve().parent
PATCH_STATE_SPEC = importlib.util.spec_from_file_location("harmony_patch_state", HERE / "patch_state.py")
patch_state = importlib.util.module_from_spec(PATCH_STATE_SPEC)
assert PATCH_STATE_SPEC.loader is not None
PATCH_STATE_SPEC.loader.exec_module(patch_state)


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
        self.assertIn("reportDetailImagePayloadScope } from '../util/PreviewState';", detail_transform)
        self.assertIn("previewGeneration: currentPreviewRouteGeneration()", detail_transform)
        self.assertIn("private tvRightColumn(): void", detail_transform)
        self.assertIn("previewWorkId: this.workId", detail_transform)
        self.assertIn("reportDetailLayoutStageForScope('Detail', this.workId, currentPreviewRouteGeneration(), 'detail-rails-count'", detail_transform)
        self.assertIn("matchingRowCount > 0 ? 'row-match-found' : 'row-match-missing'", detail_transform)
        self.assertIn("reportDetailImagePayloadScope(previewContext, thumb.value as Object as string)", detail_transform)
        self.assertIn("this.artworkStore.getArtwork(item.id) !== undefined", detail_transform)
        self.assertIn("artworkStorePresent ? 'artwork-store-present' : 'artwork-store-absent'", detail_transform)
        self.assertIn("reportDetailRowImageStage(previewContext, 'artwork-store-updated')", detail_transform)
        self.assertIn("reportDetailRowImageStage(previewContext,", detail_transform)
        row_update = detail_transform.split('new = """', 1)[1].split('"""', 1)[0]
        self.assertLess(row_update.index("'row-match-found'"),
                        row_update.index("this.artworkStore.setArtwork"))
        self.assertLess(detail_transform.index("this.rails = rails;"),
                        detail_transform.index("'detail-rails-count', rails.length"))
        self.assertLess(self.patch_rail.index(".height(this.listHeight > 0 ? this.listHeight : '100%')"),
                        self.patch_rail.index(".onAppear(() => {"))
        self.assertIn("reportDetailLayoutStageForScope(this.previewRoute, this.previewWorkId, this.previewGeneration, 'rail-items-count'", self.patch_rail)
        self.assertIn("rail-items-count", self.patch_rail)
        self.assertIn("rail-item-appear", self.patch_rail)
        self.assertIn("ListItem()", self.patch_rail)
        self.assertIn("reportDetailLayoutStageForScope(this.previewRoute, this.previewWorkId, this.previewGeneration, 'rail-item-appear'", self.patch_rail)
        self.assertIn("@Prop @Watch('previewItemsUpdated') items: MediaRailItem[] = []", self.patch_rail)
        self.assertIn("s = s.replace(plain, preview_prop + watched_prop", self.patch_rail)
        self.assertIn("s = s.replace(prop, preview_prop + watched_prop", self.patch_rail)
        self.assertIn("'rail-items-prop-update-count', this.items.length", self.patch_rail)
        self.assertIn("if (this.previewRoute !== 'Detail' || this.previewWorkId.length === 0)", self.patch_rail)
        list_item_transform = self.patch_rail.split("s = s.replace(builder,", 1)[1]
        self.assertIn("reportDetailLayoutStageForScope(this.previewRoute, this.previewWorkId, this.previewGeneration, 'rail-item-appear'", list_item_transform)
        self.assertNotIn("artworkState", self.patch_rail)
        self.assertIn("reportDetailLayoutStageForScope(this.previewRoute, this.previewWorkId, this.previewGeneration", self.patch_rail)
        self.assertNotRegex(self.patch_rail, r"@Prop\s+\w+\s*:\s*\([^\n]*=>")
        self.assertIn("rail-list-area", self.patch_rail)
        self.assertIn("rail-list-height-default-fill", self.patch_rail)
        self.assertNotIn("@Prop onPreview", card_transform + self.patch_rail)
        self.assertNotRegex(card_transform + self.patch_rail, r"@Prop\s+\w+\s*:\s*\([^\n]*=>")


    def test_observed_artwork_store_is_rendered_by_concrete_poster_child(self):
        self.assertIn("@Observed\nclass DetailArtworkStore", self.detail_source)
        self.assertIn("@Track revision: number = 0", self.detail_source)
        self.assertIn("@Track private pixelMaps: Map<string, image.PixelMap>", self.detail_source)
        self.assertIn("@ObjectLink artworkStore: DetailArtworkStore", self.detail_source)
        self.assertIn("artwork: this.artworkStore.getArtwork(this.rowId)", self.detail_source)
        self.assertIn("this.artworkStore.setArtwork(generation, item.id, thumb.value)", self.detail_source)
        self.assertIn("PosterCard({\n      variant: this.variant,", self.detail_source)
        self.assertNotIn("artworkState", self.detail_source)
        self.assertIn("DetailRowArtworkCard({\n        artworkStore: this.artworkStore,\n        rowId: (item as DetailRow).id,", self.detail_source)
        self.assertEqual(self.detail_source.count("DetailRowArtworkCard({"), 5)
        self.assertNotIn("@BuilderParam cardBuilder", self.detail_source)
        self.assertNotIn("cardBuilder: (artwork:", self.detail_source)
        self.assertIn("previewRowId: (item as DetailRow).id", self.patch_state)
        self.assertIn("artwork_store_arg", self.patch_state)
        self.assertIn("artworkStorePresent", self.patch_state)
        self.assertNotIn("pixelMaps", self.patch_state)
        self.assertNotIn("visible-item-stamp-", self.patch_rail + self.patch_state)

    def test_artwork_store_contract_checks_generation_before_mutation(self):
        store = self.detail_source.split("class DetailArtworkStore {", 1)[1].split("\n}", 1)[0]
        begin = store.split("beginGeneration(): number {", 1)[1].split("\n  }", 1)[0]
        setter = store.split("setArtwork(generation: number, rowId: string, pixelMap: image.PixelMap): void {", 1)[1].split("\n  }", 1)[0]
        self.assertLess(begin.index("this.generation += 1"), begin.index("return this.generation"))
        self.assertIn("if (!this.isCurrentGeneration(generation)) {\n      return;\n    }", setter)
        self.assertLess(setter.index("return;"), setter.index("this.pixelMaps.set(rowId, pixelMap)"))
        self.assertIn("return generation === this.generation", store)
        self.assertIn("this.artworkStore.setArtwork(generation, 'chapter-' + chapter.index.toString(), thumb.value)", self.detail_source)

    def test_preview_artwork_transform_keeps_the_captured_generation_guard(self):
        detail_transform = self.patch_state.split("def detail(s):", 1)[1].split("\ndef card_dbg(s):", 1)[0]
        old = detail_transform.split("old = \"\"\"", 1)[1].split("\"\"\"", 1)[0]
        new = detail_transform.split("new = \"\"\"", 1)[1].split("\"\"\"", 1)[0]
        self.assertIn("isCurrentGeneration(generation)", old)
        self.assertIn("isCurrentGeneration(generation)", new)
        self.assertIn("setArtwork(generation, item.id, thumb.value)", new)

    def test_episode_sources_are_instrumented_once_with_scoped_payload_and_store_stages(self):
        transformed = patch_state.instrument_episode_art(self.detail_source)
        branches = (
            ("episode-still", "still", "stillContext"),
            ("media-thumbnail", "frame", "frameContext"),
            ("series-artwork fallback", "seriesArtwork", "seriesArtworkContext"),
        )
        for branch, result, context in branches:
            with self.subTest(branch=branch):
                self.assertIn('assert count == 1, f"expected exactly one {branch} episode-art branch, found {count}"',
                              self.patch_state)
                self.assertEqual(transformed.count(f"reportDetailRowImageStage({context}, 'fetch-start')"), 1)
                self.assertEqual(transformed.count(f"reportDetailRowImageStage({context}, 'fetch-ok')"), 1)
                self.assertEqual(transformed.count(f"reportDetailRowImageStage({context}, 'fetch-error')"), 1)
                self.assertEqual(transformed.count(f"reportDetailRowImageStage({context}, 'bridge-source-ready')"), 1)
                payload_value = result if result == "seriesArtwork" else result + ".value"
                self.assertEqual(transformed.count(f"reportDetailImagePayloadScope({context}, {payload_value} as Object as string)"), 1)
                self.assertEqual(transformed.count(f"reportDetailRowImageStage({context}, 'artwork-store-updated')"), 1)
                self.assertEqual(transformed.count(f"reportDetailRowImageStage({context}, 'assigned')"), 1)
        self.assertIn("reportDetailRowImageStage(previewContext, 'fetch-start')", self.patch_state)

    def test_episode_instrumentation_checks_generation_after_each_await(self):
        transformed = patch_state.instrument_episode_art(self.detail_source)
        awaited_results = (
            "const still = await fetchEpisodeArtwork",
            "const frame = await fetchMediaThumbnail",
            "const seriesArtwork = await heroArtworkPromise",
        )
        for awaited in awaited_results:
            start = transformed.index(awaited)
            guard = transformed.index("if (!this.artworkStore.isCurrentGeneration(generation))", start)
            result_stage = transformed.index("reportDetailRowImageStage(", guard + 1)
            self.assertLess(start, guard)
            self.assertLess(guard, result_stage)

    def test_preview_scope_generation_is_captured_as_scalar_props(self):
        self.assertIn("previewGeneration: currentPreviewRouteGeneration()", self.patch_state)
        self.assertIn("export function currentPreviewRouteGeneration(): number", self.preview_state)
        self.assertIn("generation !== PREVIEW_ROUTE_GENERATION", self.preview_state)
        self.assertIn("return new DetailRowImageContext(PREVIEW_ROUTE, parentWorkId, rowId, PREVIEW_ROUTE_GENERATION);", self.preview_state)

    def test_preview_payload_scope_extracts_only_ephemeral_numeric_image_key(self):
        self.assertIn("export function reportDetailImagePayloadScope(context: DetailRowImageContext, imageUrl: string): void", self.preview_state)
        self.assertIn("imageUrl.match(/\\/img\\/([0-9]+)$/)", self.preview_state)
        self.assertIn("image_id: match[1]", self.preview_state)
        self.assertIn("previewPost('/image-metrics-scope', body)", self.preview_state)
        self.assertIn("if (route !== 'Detail'", self.preview_state)

    def test_episode_art_screenshot_guard_is_limited_to_series_detail(self):
        capture = (HERE / "capture.py").read_text(encoding="utf-8")
        self.assertIn("frame_observer=inspect_episode_art if name == \"series-detail\" else None", capture)
        self.assertIn('failure = failure_override if failure_override is not None else metrics["status"]', capture)
        self.assertIn('failure_override="row-artwork-timeout"', capture)
        self.assertIn("episode_art=episode_art_result.get(\"metrics\")", capture)
        self.assertIn("debug('snap-' + name, img)", capture)
        self.assertIn("(image if image is not None else png()).save", capture)
        self.assertNotIn("decoded_art[theme] = True", capture)
        self.assertLess(capture.index("snap(name, folder, 100000"),
                        capture.index("decoded_art[theme] = decoded_art_is_accepted"))


if __name__ == "__main__":
    unittest.main()
