import unittest
from pathlib import Path
import importlib.util
import re


HERE = Path(__file__).resolve().parent
PATCH_STATE_SPEC = importlib.util.spec_from_file_location("harmony_patch_state", HERE / "patch_state.py")
patch_state = importlib.util.module_from_spec(PATCH_STATE_SPEC)
assert PATCH_STATE_SPEC.loader is not None
PATCH_STATE_SPEC.loader.exec_module(patch_state)
PATCH_RAIL_SPEC = importlib.util.spec_from_file_location("harmony_patch_rail", HERE / "patch_rail.py")
patch_rail_transform = importlib.util.module_from_spec(PATCH_RAIL_SPEC)
assert PATCH_RAIL_SPEC.loader is not None
PATCH_RAIL_SPEC.loader.exec_module(patch_rail_transform)


class PreviewPatchContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.patch_state = (HERE / "patch_state.py").read_text(encoding="utf-8")
        cls.patch_rail = (HERE / "patch_rail.py").read_text(encoding="utf-8")
        cls.preview_state = (HERE / "overlay/src/main/ets/util/PreviewState.ets").read_text(encoding="utf-8")
        cls.detail_source = (HERE.parents[1] / "clients/harmony/entry/src/main/ets/pages/Detail.ets").read_text(encoding="utf-8")

    def test_preview_series_episode_item_keeps_the_ring_and_unseen_dot(self):
        # the preview swaps in its own seriesEpisodeItem builder; it must pass what the production one passes
        self.assertIn("ringOn: !isTvMetrics() && this.nextUpEpisodeId() === (item as DetailRow).id,", self.patch_state)
        self.assertIn("unseen: this.episodeUnseen(item as DetailRow),", self.patch_state)
        self.assertIn("ringOn: !isTvMetrics() && this.nextUpEpisodeId() === (item as DetailRow).id,", self.detail_source)

    def test_player_surface_placeholder_is_replaced(self):
        source = (HERE.parents[1] / "clients/harmony/entry/src/main/ets/pages/Player.ets").read_text(encoding="utf-8")
        patched = patch_state.player(source)
        self.assertNotIn("playarr-player-surface", patched)
        self.assertIn("Column().width('100%').height('100%')", patched)

    def test_watchlist_resolve_is_counted_as_pending(self):
        patched = patch_state.detail(self.detail_source)
        body = patched.split("private async loadWatchlistState", 1)[1].split("private async toggleWatchlist", 1)[0]
        self.assertLess(body.index("previewReport('img=1')"), body.index("await resolveTitle"))
        self.assertGreater(body.index("previewReport('img=-1')"), body.index("this.listed = false"))

    def test_preview_reporting_uses_scalar_props_and_no_function_props(self):
        card_transform = self.patch_state.split("def card(s):", 1)[1].split("\ndef nav(s):", 1)[0]
        detail_transform = self.patch_state.split("def detail(s):", 1)[1].split("\ndef card_dbg(s):", 1)[0]
        props = (
            "@Prop previewRoute: string = ''",
            "@Prop previewWorkId: string = ''",
            "@Prop previewRowId: string = ''",
            "@Prop previewGeneration: number = 0",
            "@Prop previewRailId: string = ''",
            "@Prop previewOccurrence: number = -1",
        )
        for expected in props:
            self.assertIn(expected, card_transform)
        self.assertIn("reportDetailRowImageStageForScope(this.previewRoute, this.previewWorkId, this.previewRowId, this.previewGeneration, 'on-complete')", card_transform)
        self.assertIn("@Prop @Watch('previewArtworkUpdated') artwork: image.PixelMap | undefined = undefined", card_transform)
        self.assertLess(card_transform.index("@Prop previewRoute"),
                        card_transform.index("@Prop @Watch('previewArtworkUpdated') artwork"))
        self.assertLess(card_transform.index("@Prop previewOccurrence"),
                        card_transform.index("@Prop @Watch('previewArtworkUpdated') artwork"))
        self.assertIn("'poster-artwork-prop-undefined' : 'poster-artwork-prop-present'", card_transform)
        self.assertIn("'poster-render-artwork-present'", card_transform)
        self.assertIn("'poster-render-artwork-undefined'", card_transform)
        self.assertIn("reportDetailLayoutStageForScope(this.previewRoute, this.previewWorkId, this.previewGeneration, 'poster-card-root-area'", card_transform)
        self.assertIn("this.previewRoute === 'Detail' && this.previewWorkId.length > 0 && this.previewRowId.length > 0", card_transform)
        self.assertNotIn("previewEpisodeCard", card_transform)
        self.assertIn("previewRowId: (item as DetailRow).id", detail_transform)
        self.assertIn("previewRailId: railId", detail_transform)
        self.assertIn("previewOccurrence: index", detail_transform)
        self.assertIn("import { PosterCard } from '../design/components/PosterCard';\\nimport { setPreviewRouteContext, currentPreviewRouteGeneration", detail_transform)
        self.assertIn("reportDetailImagePayloadScope, reportDetailEpisodeTargetForScope, reportDetailEpisodeCardContainerAreaForScope, reportDetailSeriesTargetCardVisibilityForScope, reportDetailSeriesTargetAreaSampleForScope, reportDetailPreviewGenerationScope", detail_transform)
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
        self.assertLess(self.patch_rail.index("list_on_appear ="),
                        self.patch_rail.index("s = s.replace(list_on_appear,"))
        self.assertIn("'rail-items-count', this.items.length", self.patch_rail)
        self.assertIn("rail-items-count", self.patch_rail)
        self.assertIn("rail-item-appear", self.patch_rail)
        self.assertIn("ListItem()", self.patch_rail)
        self.assertIn("reportDetailLayoutStageForScope(this.previewRoute, this.previewWorkId, this.previewGeneration, 'rail-item-appear'", self.patch_rail)
        self.assertIn("@Prop @Watch('previewItemsUpdated') items: MediaRailItem[] = []", self.patch_rail)
        self.assertIn("s = s.replace(plain, preview_prop + preview_target_prop + watched_prop", self.patch_rail)
        self.assertIn("s = s.replace(prop, preview_prop + preview_target_prop + watched_prop", self.patch_rail)
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
    def test_phone_focus_selection_uses_profile_and_rejects_offscreen_rail_cards(self):
        route_source = (HERE / "patch_route.py").read_text(encoding="utf-8")
        self.assertIn("import { isTvMetrics } from '../design/Metrics';", route_source)
        self.assertIn("previewFocusFirstCard(isTvMetrics())", route_source)
        self.assertIn("export function previewFocusFirstCard(tvMode: boolean)", self.preview_state)
        self.assertIn("selectPreviewCard(PREVIEW_CARDS, tvMode)", self.preview_state)
        self.assertNotIn("maxX >= 500", self.preview_state)

    def test_observed_artwork_store_is_rendered_by_concrete_poster_child(self):
        self.assertIn("@Observed\nclass DetailArtworkStore", self.detail_source)
        self.assertIn("@Track revision: number = 0", self.detail_source)
        self.assertIn("@Track private pixelMaps: Map<string, image.PixelMap>", self.detail_source)
        self.assertIn("@ObjectLink artworkStore: DetailArtworkStore", self.detail_source)
        self.assertIn("artwork: this.artworkStore.getArtwork(this.rowId)", self.detail_source)
        self.assertIn("this.artworkStore.setArtwork(generation, item.id, thumb.value)", self.detail_source)
        self.assertIn("@Builder\n  private posterCard(): void {\n    PosterCard({\n      variant: this.variant,", self.detail_source)
        self.assertNotIn("artworkState", self.detail_source)
        self.assertIn("DetailRowArtworkCard({\n        artworkStore: this.artworkStore,\n        rowId: (item as DetailRow).id,", self.detail_source)
        self.assertEqual(self.detail_source.count("DetailRowArtworkCard({"), 6)
        self.assertNotIn("@BuilderParam cardBuilder", self.detail_source)
        self.assertNotIn("cardBuilder: (artwork:", self.detail_source)
        self.assertIn("previewRowId: (item as DetailRow).id", self.patch_state)
        self.assertIn("artwork_store_arg", self.patch_state)
        self.assertIn("artworkStorePresent", self.patch_state)
        self.assertNotIn("pixelMaps", self.patch_state)
        self.assertNotIn("visible-item-stamp-", self.patch_rail + self.patch_state)

    def test_component_ids_are_conditionally_applied_to_focus_root_and_scoped_image(self):
        poster_source = (HERE.parents[1] / "clients/harmony/entry/src/main/ets/design/components/PosterCard.ets").read_text(encoding="utf-8")
        component_helper = (HERE.parents[1] / "clients/harmony/entry/src/main/ets/design/ComponentMeasurement.ets").read_text(encoding="utf-8")
        image_branch = poster_source.split("Image(this.artwork)", 1)[1].split(".width('100%')", 1)[0]
        root_branch = poster_source.split(".focusable(true)", 1)[1].split(".onFocus(() =>", 1)[0]
        self.assertIn("NonEmptyComponentIdModifier(this.imageMeasurementId)", image_branch)
        detail_wrapper = self.detail_source.split("struct DetailRowArtworkCard {", 1)[1].split(
            "interface DetailRail {", 1)[0]
        self.assertIn("NonEmptyComponentIdModifier(this.measurementId)", detail_wrapper)
        self.assertIn(".id(this.focusId.length > 0 ? this.focusId : 'detail-card-' + this.rowId)", detail_wrapper)
        self.assertNotIn("NonEmptyComponentIdModifier(this.measurementId)", root_branch)
        self.assertNotIn(".id(this.imageMeasurementId)", poster_source)
        self.assertNotIn(".id(this.measurementId)", poster_source)
        self.assertIn("if (this.componentId.length > 0)", component_helper)
        self.assertIn("instance.id(this.componentId)", component_helper)
        self.assertEqual(self.detail_source.count("measurementId: this.measurementId,"), 1)
        self.assertNotIn("'detail-art-' + encodeURIComponent(this.rowId)", self.detail_source)
        self.assertNotIn("'detail-image-' + encodeURIComponent(this.rowId)", self.detail_source)

    def test_full_detail_transform_scopes_six_rows_and_keeps_series_rail(self):
        transformed = patch_state.detail(self.detail_source)
        load_detail = transformed.split("private async loadDetail(): Promise<void>", 1)[1].split(
            "private async loadHeroArtwork", 1)[0]
        self.assertIn("setPreviewRouteContext('Detail'", load_detail)
        self.assertLess(load_detail.index("setPreviewRouteContext('Detail'"),
                        load_detail.index("beginPreviewDetailLoad(this.workId)"))
        self.assertIn("reportPreviewDetailLoad(workId, previewLoadGeneration, previewLoadSequence, 'api-result'", load_detail)
        self.assertIn("const previewLoadSequence: number = this.previewLoadSequence", load_detail)
        self.assertIn("this.previewLoadSequence, 'render-state', 'error'", transformed)
        self.assertIn("this.previewLoadSequence, 'render-state', 'loading'", transformed)
        self.assertIn("this.previewLoadSequence, 'render-state', 'detail-ready'", transformed)
        scoped_card = re.compile(
            r"artworkStore: this\.artworkStore,\n\s*rowId: \(item as DetailRow\)\.id,\n"
            r"\s*previewRoute: 'Detail',\n\s*previewWorkId: this\.workId,\n"
            r"\s*previewRowId: \(item as DetailRow\)\.id,\n"
            r"\s*previewGeneration: (?:currentPreviewRouteGeneration\(\)|this\.previewScopeGeneration),"
        )
        self.assertEqual(len(scoped_card.findall(transformed)), 6)
        episode_builder = transformed.split("private seriesEpisodeItem(", 1)[1].split(
            "/** Similar-title row content", 1)[0]
        self.assertIn("rowId: (item as DetailRow).id,\n      previewRoute: 'Detail',\n      previewWorkId: this.workId,", episode_builder)
        self.assertIn("previewGeneration: this.previewScopeGeneration,\n      previewRailId: railId,\n      previewOccurrence: index,", episode_builder)
        self.assertIn("measurementId: this.seriesMeasurementId('card', this.workId, this.seriesFocusGeneration, railId,",
                      episode_builder)
        self.assertIn("imageMeasurementId: this.seriesMeasurementId('image', this.workId, this.seriesFocusGeneration, railId,",
                      episode_builder)
        self.assertNotRegex(episode_builder, r"(?m)^\s*const\s+")
        self.assertIn("private tvSeriesSeasonRows(): void", transformed)
        series_rows_source = self.detail_source.split("private tvSeriesSeasonRows(): void {", 1)[1].split(
            "private chapterItem(", 1)[0]
        generic_right_column = self.detail_source.split("private tvRightColumn(): void {", 1)[1].split(
            "private tvSeriesSeasonRows(", 1)[0]
        self.assertIn("measurementId: this.seriesMeasurementId('rail', this.workId, this.seriesFocusGeneration, rail.id)",
                      series_rows_source)
        self.assertNotIn("measurementId: this.seriesMeasurementId('rail'", generic_right_column)
        self.assertIn("initialItemIndex: this.initialEpisodeIndex(rail)", transformed)
        self.assertIn("onInitialItemPositioned: (): void => { this.reportPreviewEpisodePositionedCallback(rail); this.seriesEpisodeIndexPositioned(rail); }", transformed)
        self.assertIn("episodeCaption: (item as DetailRow).episodeCaption ?? ''", transformed)
        self.assertIn("private previewScopeGeneration: number = 0;", transformed)
        measurement_helper = transformed.split("private seriesMeasurementId(", 1)[1].split("\n  }", 1)[0]
        self.assertIn("seriesDetailMeasurementId(kind, workId, this.previewScopeGeneration, railId, episodeId, occurrence)",
                      measurement_helper)
        self.assertNotIn("seriesDetailMeasurementId(kind, workId, generation, railId, episodeId, occurrence)",
                         measurement_helper)
        for stage in ("resume-plan-loaded", "target-present", "target-in-any-rail", "target-card-mounted",
                      "target-season-scroll-requested", "target-episode-scroll-requested", "focus-pending", "focus-suppressed",
                      "focus-request-count"):
            self.assertIn("'" + stage + "'", transformed)
        prerequisite_report = transformed.split("private reportPreviewSeriesPrerequisite(", 1)[1].split("\n  }\n", 1)[0]
        self.assertIn("if (previous === value)", prerequisite_report)
        self.assertIn("this.previewReportedSeriesPrerequisites.set(stage, value)", prerequisite_report)
        self.assertNotIn("reportPreviewSeriesFocusReadiness", transformed)
        card_appeared = transformed.split("private seriesEpisodeCardAppeared(", 1)[1].split("private tryInitialEpisodeFocus(): void {", 1)[0]
        self.assertIn("'target-card-mounted', 1", card_appeared)
        self.assertIn("reportDetailEpisodeTargetForScope('Detail', this.workId, episodeId, this.previewScopeGeneration)", card_appeared)
        self.assertIn("this.previewScopeGeneration, stage, value, -1, -1", prerequisite_report)
        self.assertNotRegex(prerequisite_report, r"(?:rowId|episode_id|title|url)")
        load_detail = transformed.split("private async loadDetail(): Promise<void> {", 1)[1].split("private async loadHeroArtwork(", 1)[0]
        self.assertEqual(load_detail.count("this.previewScopeGeneration = currentPreviewRouteGeneration();"), 1)
        self.assertIn("this.previewSeasonRowAreas = new Map();", load_detail)
        self.assertIn("previewRoute: 'Detail',\n              previewWorkId: this.workId,\n              previewGeneration: this.previewScopeGeneration,", transformed)
        self.assertIn("this.reportPreviewTargetSeasonArea(rail, area);", transformed)
        self.assertIn("this.reportPreviewStoredTargetSeasonArea();", transformed)
        self.assertIn("'series-target-season-row-area', 1, rowWidthVp, rowHeightVp", transformed)
        self.assertIn("'series-target-season-centre-delta-vp', rowTopVp + rowHeightVp / 2 - tv(SERIES_COLUMN_HEIGHT) / 2", transformed)
        report_method = transformed.split("private reportPreviewTargetSeasonMeasurements(", 1)[1].split("private reportPreviewEpisodePositionedCallback(", 1)[0]
        self.assertNotIn("currentPreviewRouteGeneration()", report_method)
        self.assertIn("private reportPreviewTargetSeasonMeasurements(rowTopVp: number", transformed)
        self.assertIn("this.reportPreviewTargetSeasonMeasurements(rowArea.top, rowArea.width, rowArea.height)", transformed)
        self.assertIn("interface DetailSeasonRowArea {\n  top: number;\n  height: number;\n}", transformed)
        self.assertIn("interface PreviewDetailSeasonRowArea {\n  top: number;\n  width: number;\n  height: number;\n}", transformed)
        self.assertIn("private previewSeasonRowAreas: Map<string, PreviewDetailSeasonRowArea>", transformed)
        self.assertIn("this.previewSeasonRowAreas.set(rail.id, { top: rowTopVp, width: rowWidthVp, height: rowHeightVp })", transformed)
        layout_reports = re.findall(r"reportDetailLayoutStageForScope\((.*?)\);", report_method, re.DOTALL)
        self.assertEqual(len(layout_reports), 2)
        for report in layout_reports:
            self.assertIn("'Detail', this.workId, this.previewScopeGeneration", report)
            self.assertNotRegex(report, r"(?:rowId|episode_id|title|url)")
        load_resume_plan = transformed.split("private async loadResumePlan(", 1)[1].split("private primaryLabel(", 1)[0]
        self.assertLess(load_resume_plan.index("this.resumePlan = result.value;"),
                        load_resume_plan.index("this.reportPreviewStoredTargetSeasonArea();"))
        stored_report = transformed.split("private reportPreviewStoredTargetSeasonArea(): void {", 1)[1].split("private seriesEpisodeIndexPositioned(", 1)[0]
        self.assertIn("this.previewSeasonRowAreas.get(rail.id)", stored_report)
        self.assertIn("rowArea.width", stored_report)
        self.assertNotIn("currentPreviewRouteGeneration()", stored_report)
        focus_branch = transformed.split("private tryInitialEpisodeFocus(railId: string | null = null", 1)[1].split("private railIdForEpisode(", 1)[0]
        self.assertLess(focus_branch.index("'series-focus-request-count'"),
                        focus_branch.index("requestFocus(seriesEpisodeFocusId(episodeId))"))
        self.assertIn("this.previewSeriesFocusRequestCount += 1;", focus_branch)
        self.assertIn("const previewAreaRouteGeneration = this.previewCardAreaRouteGenerations.get(measurementId)",
                      focus_branch)
        self.assertIn("reportDetailPreviewGenerationScope(workId, previewAreaRouteGeneration, currentPreviewRouteGeneration())",
                      focus_branch)
        self.assertNotIn("this.previewScopeGeneration = currentPreviewRouteGeneration()", focus_branch)
        focused_method = transformed.split("private seriesEpisodeCardFocused(", 1)[1].split("private resumeTargetEpisodeId(", 1)[0]
        self.assertIn("this.seriesFocusedRowIsTarget = isSeriesEpisodeTargetFocused", focused_method)
        self.assertIn("'series-focused-row-is-target', focusValue", focused_method)
        self.assertIn("'series-focus-request-result', 1", focused_method)
        self.assertLess(focused_method.index("this.episodeFocusGate.recordCurrentFocus"),
                        focused_method.index("'series-focused-row-is-target'"))
        self.assertIn("'series-focused-row-is-target', 0, -1, -1", transformed.split(
            "private noteOtherDetailFocus(workId: string, generation: number): void {", 1)[1].split(
            "private otherDetailFocusReporter(", 1)[0])
        self.assertIn("'series-focused-row-is-target', 0, -1, -1", transformed.split(
            "private cancelInitialEpisodeFocus(): void {", 1)[1].split("private noteOtherDetailFocus(", 1)[0])
        self.assertIn("'series-focus-request-issued', issued ? 1 : 0", focus_branch)
        self.assertIn("'series-focus-request-result', 0", focus_branch)
        self.assertLess(focus_branch.index("this.episodeFocusGate.beginRequest()"),
                        focus_branch.index("issueEpisodeFocusRequest"))
        self.assertIn("this.episodeFocusGate.rollbackRequest()", focus_branch)
        self.assertIn("reportDetailEpisodeCardContainerAreaForScope('Detail', workId, episodeId, this.previewScopeGeneration", transformed)
        self.assertNotIn("reportDetailEpisodeCardContainerAreaForScope('Detail', workId, episodeId, generation", transformed)
        self.assertIn("reportDetailSeriesTargetCardVisibilityForScope('Detail', workId, this.previewScopeGeneration", focus_branch)  # the bridge scopes by the preview route generation
        self.assertIn("if (cardMeasurement === undefined || cardMeasurement === null || card === undefined || card === null ||", focus_branch)
        self.assertIn("rail === undefined || rail === null || page === undefined || page === null ||", focus_branch)
        self.assertIn("!Number.isFinite(pageOffset)", focus_branch)
        self.assertIn("pageOffset, currentRailOffset, 1", focus_branch)
        self.assertIn("intersectionRight - intersectionLeft", focus_branch)
        season_builder = transformed.split("private tvSeriesSeasonRows(): void {", 1)[1].split("private chapterItem(", 1)[0]
        self.assertLess(season_builder.index("this.rememberPreviewSeasonArea(rail, area)"),
                        season_builder.index("this.reportPreviewTargetSeasonArea(rail, area)"))
        self.assertLess(season_builder.index("this.reportPreviewTargetSeasonArea(rail, area)"),
                        season_builder.index("this.onSeriesSeasonRowAreaChanged(rail, area)"))
        self.assertIn("reportDetailEpisodeTargetForScope('Detail', this.workId, result.value.target.episode_id", transformed)

    def test_preview_rail_transform_accepts_current_initial_index_form_once(self):
        rail_source = (HERE.parents[1] / "clients/harmony/entry/src/main/ets/design/components/MediaRail.ets").read_text(encoding="utf-8")
        transformed = patch_rail_transform.transform(rail_source)
        self.assertIn("@Prop @Watch('onInitialItemIndexChanged') initialItemIndex: number = -1;", transformed)
        self.assertIn("onInitialItemPositioned: () => void = () => {};", transformed)
        self.assertIn("this.listScroller.scrollToIndex(this.initialItemIndex, false, ScrollAlign.CENTER);", transformed)
        self.assertIn("this.onInitialItemPositioned();", transformed)
        self.assertEqual(transformed.count("@Prop previewRoute: string = '';"), 1)
        self.assertEqual(transformed.count("'rail-list-height-explicit'"), 1)
        self.assertEqual(patch_rail_transform.transform(transformed), transformed)
        self.assertEqual(transformed.count(".onAreaChange("), rail_source.count(".onAreaChange("))
        self.assertEqual(transformed.count("this.listHasAppeared = true;"), 1)
        self.assertEqual(transformed.count(".onAppear(() => {"), rail_source.count(".onAppear(() => {") + 1)
        self.assertIn("'target-episode-initial-index-watch', this.initialItemIndex", transformed)
        self.assertIn("'target-episode-list-appeared', this.initialItemIndex", transformed)
        self.assertIn("'target-episode-initial-index-applied', this.initialItemIndex", transformed)
        self.assertIn("'target-episode-live-item-count-at-callback', this.items.length", transformed)
        self.assertIn("@Prop previewTargetEpisodeId: string = '';", transformed)
        self.assertIn("this.items.findIndex((item: MediaRailItem): boolean =>", transformed)
        self.assertIn("item.id === this.previewTargetEpisodeId", transformed)
        self.assertIn("previewTargetEpisodeId: this.resumeTargetEpisodeId() ?? ''", patch_state.detail(self.detail_source))
        self.assertIn("'target-episode-initial-index-watch-hook-ran', 1", transformed)
        self.assertIn("'target-episode-list-appeared-hook-ran', 1", transformed)
        self.assertLess(transformed.index("'target-episode-initial-index-watch-hook-ran', 1"),
                        transformed.index("'target-episode-initial-index-watch', this.initialItemIndex"))
        self.assertLess(transformed.index("'target-episode-list-appeared-hook-ran', 1"),
                        transformed.index("'target-episode-list-appeared', this.initialItemIndex"))
        self.assertIn("index < 0", transformed)

    def test_detail_area_geometry_uses_existing_callback_and_reports_no_identity(self):
        detail_source = (HERE.parents[1] / "clients/harmony/entry/src/main/ets/pages/Detail.ets").read_text(encoding="utf-8")
        transformed = patch_state.detail(detail_source)
        self.assertEqual(transformed.count(".onAreaChange("), detail_source.count(".onAreaChange("))
        card_area = transformed.split("struct DetailRowArtworkCard {", 1)[1].split(
            "interface DetailRail {", 1)[0]
        callback = card_area.split(".onAreaChange((_oldArea: Area, area: Area) => {", 1)[1].split("})", 1)[0]
        self.assertLess(callback.index("this.onCardArea(area)"), callback.index("reportDetailAreaGeometryForScope"))
        self.assertIn("this.previewRoute, this.previewWorkId, this.previewGeneration, area", callback)
        preview_state = (HERE / "overlay/src/main/ets/util/PreviewState.ets").read_text(encoding="utf-8")
        geometry_reporter = preview_state.split("export function reportDetailAreaGeometryForScope(", 1)[1].split(
            "export function captureDetailRowImageContext(", 1)[0]
        for expected in ("area.position.x", "area.position.y", "area.globalPosition.x", "area.globalPosition.y",
                         "area.width", "area.height"):
            self.assertIn(expected, geometry_reporter)
        self.assertIn("enum PreviewAreaLengthTypeCode", preview_state)
        self.assertIn("enum PreviewAreaUnitCode", preview_state)
        self.assertNotIn("rowId", geometry_reporter)
        self.assertNotIn("title", geometry_reporter)
        self.assertNotIn("url", geometry_reporter)
        self.assertIn("return Number.isFinite(value) ? value : null", preview_state)
        self.assertIn("stage: 'detail-row-area-geometry'", geometry_reporter)

    def test_preview_card_patch_accepts_legacy_and_episode_copy_columns_once(self):
        poster_source = (HERE.parents[1] / "clients/harmony/entry/src/main/ets/design/components/PosterCard.ets").read_text(encoding="utf-8")
        bounded_form = "    Column({ space: this.episodeCaption.length > 0 ? 0 : Spacing.xs }) {"
        legacy_form = "    Column({ space: Spacing.xs }) {"
        self.assertEqual(poster_source.count(bounded_form), 1)
        source_forms = (
            ("legacy", poster_source.replace(bounded_form, legacy_form, 1), legacy_form),
            ("bounded", poster_source, bounded_form),
        )
        for label, source, expected_form in source_forms:
            with self.subTest(source_form=label):
                first_application = patch_state.apply_once(source, patch_state.card)
                self.assertEqual(first_application.count(expected_form), 1)
                self.assertEqual(first_application.count("private previewArtworkUpdated(): void"), 1)
                self.assertEqual(first_application.count("reportDetailRowImageStageForScope(this.previewRoute, this.previewWorkId, this.previewRowId, this.previewGeneration, 'on-complete')"), 1)
                self.assertNotIn("previewEpisodeCard", first_application)
                self.assertIn("reportDetailEpisodeCardAreaForMeasurement(this.getUIContext()", first_application)
                self.assertIn("this.previewRailId, this.previewOccurrence, this.imageMeasurementId", first_application)
                self.assertNotIn("area.globalPosition", first_application)
                self.assertLess(first_application.index("@Prop previewOccurrence"),
                                first_application.index("@Prop @Watch('previewArtworkUpdated') artwork"))
                self.assertLess(first_application.index("@Prop imageMeasurementId"),
                                first_application.index("@Prop @Watch('previewArtworkUpdated') artwork"))
                self.assertNotIn("reportDetailEpisodeCardAreaForScope", first_application)
                second_application = patch_state.apply_once(first_application, patch_state.card)
                self.assertEqual(second_application, first_application)

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
        self.assertIn("reportDetailEpisodeTargetForScope", self.preview_state)
        self.assertIn("reportDetailEpisodeCardAreaForScope", self.preview_state)
        self.assertIn("reportDetailEpisodeCardContainerAreaForScope", self.preview_state)
        self.assertIn("reportDetailSeriesTargetCardVisibilityForScope", self.preview_state)
        art_reporter = self.preview_state.split("export function reportDetailEpisodeCardAreaForScope(", 1)[1].split(
            "export function reportDetailEpisodeCardAreaForMeasurement(", 1)[0]
        container_reporter = self.preview_state.split("export function reportDetailEpisodeCardContainerAreaForScope(", 1)[1].split(
            "export function reportDetailEpisodeCardAreaForScope(", 1)[0]
        self.assertIn("uiContext.vp2px(1)", self.preview_state)
        self.assertIn("if (!Number.isFinite(densityPixels) || densityPixels <= 0)", art_reporter)
        self.assertIn("Number.isFinite(densityPixels) && densityPixels > 0", container_reporter)
        self.assertNotIn("import { display } from '@kit.ArkUI';", self.preview_state)
        self.assertNotIn("display.getDefaultDisplaySync().densityPixels", self.preview_state)

    def test_episode_art_screenshot_guard_is_limited_to_series_detail(self):
        capture = (HERE / "capture.py").read_text(encoding="utf-8")
        diagnostics = (HERE / "capture_diagnostics.py").read_text(encoding="utf-8")
        self.assertIn("frame_observer=inspect_episode_art if name == \"series-detail\" else None", capture)
        self.assertIn("episode_art_events_ready(events, sequence_after=cursor", capture)
        self.assertIn("focus_failure = series_focus_failure(layout, episode_art_result.get(\"metrics\"))", capture)
        self.assertIn("accepted = decoded_art[theme] and focus_failure is None", capture)
        self.assertIn('manifest["screen_selection"]["series_detail_accepted"] = series_detail_acceptance', capture)
        self.assertIn('raise Skip(failure or "series-detail-not-accepted")', capture)
        self.assertIn("frame, events=current.get(\"debug_events\", []), sequence_after=cursor", capture)
        self.assertIn('failure = failure_override if failure_override is not None else metrics["status"]', capture)
        self.assertIn('failure_override="row-artwork-timeout"', capture)
        self.assertIn("episode_art=episode_art_result.get(\"metrics\")", capture)
        self.assertIn("debug('snap-' + name, img)", capture)
        self.assertNotIn("EPISODE_ART_BOUNDS", diagnostics)
        self.assertIn("detail-episode-card-area", diagnostics)
        self.assertIn("detail-episode-card-container-area", diagnostics)
        self.assertNotIn("series-target-season-centre-delta-vp", diagnostics[diagnostics.index("def series_focus_failure"):diagnostics.index("def summarize_detail_image_payload_events")])
        self.assertIn("detail-row-image-on-complete", diagnostics)
        self.assertIn("x_vp * density", diagnostics)
        self.assertIn("(image if image is not None else png()).save", capture)
        self.assertNotIn("decoded_art[theme] = True", capture)
        self.assertLess(capture.index("snap(name, folder, 100000"),
                        capture.index("decoded_art[theme] = decoded_art_is_accepted"))

    def test_backend_preflight_is_sanitized_and_fail_closed_before_detail_capture(self):
        capture = (HERE / "capture.py").read_text(encoding="utf-8")
        detail_capture = capture.split("def capture_selected_detail(", 1)[1].split(
            "def capture_selected(", 1)[0]
        self.assertIn("preflight = check_backend(os.environ.get(\"SERVER_URL\", \"\"))", detail_capture)
        self.assertLess(detail_capture.index("preflight = check_backend"), detail_capture.index("spec = next("))
        self.assertIn('"backend-preflight-" + theme + ".json"', detail_capture)
        self.assertIn("if not preflight[\"ready\"]:", detail_capture)
        self.assertIn("raise Skip(\"backend-preflight-\" + str(preflight[\"failure\"]))", detail_capture)
        self.assertLess(detail_capture.index("raise Skip(\"backend-preflight-"), detail_capture.index("route(\"detail:"))

        workflow = (HERE.parents[1] / ".github/workflows/parity-harmony.yml").read_text(encoding="utf-8")
        render_step = workflow.split("- name: Start the bridge and the Previewer, sign in and capture", 1)[1].split(
            "- name: Upload the captures", 1)[0]
        self.assertIn("SERVER_URL: ${{ secrets.PLAYARR_HARMONY_TEST_SERVER_URL || secrets.PLAYARR_TEST_SERVER_URL || secrets.PLAYARR_DEVICE_TEST_SERVER_URL }}", render_step)
        self.assertLess(render_step.index("backend_preflight.py --output backend-preflight.json"),
                        render_step.index("fixture_preflight.py --output fixture-preflight.json"))
        self.assertLess(render_step.index("fixture_preflight.py --output fixture-preflight.json"),
                        render_step.index("launch() {"))
        debug_artifact = workflow.split("- name: Upload the debug frames and logs", 1)[1]
        self.assertIn("backend-preflight.json", debug_artifact)
        self.assertIn("fixture-preflight.json", debug_artifact)
        self.assertIn("capture/backend-preflight-*.json", debug_artifact)

    def test_detail_route_confirmation_is_recorded_before_visual_acceptance_gate(self):
        capture = (HERE / "capture.py").read_text(encoding="utf-8")
        detail_capture = capture.split("def capture_selected_detail(", 1)[1].split(
            "def capture_selected(", 1)[0]
        self.assertIn("if not confirm_detail_route_source(detail_sources, name, state, work_id):", detail_capture)
        self.assertLess(detail_capture.index("if not confirm_detail_route_source"),
                        detail_capture.index("if name == \"series-detail\":\n                generation = state.get"))
        self.assertNotIn("detail_sources[name] = {\"route\": \"Detail\"", detail_capture)
        self.assertIn("route_confirmed\": True", (HERE / "capture_diagnostics.py").read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()


class PreviewFocusLookTests(unittest.TestCase):
    def test_card_patch_registers_for_the_capture_only_focused_look(self):
        poster = (HERE.parents[1] / "clients/harmony/entry/src/main/ets/design/components/PosterCard.ets").read_text(encoding="utf-8")
        patched = patch_state.card(poster)
        self.assertIn("previewRegisterCard", patched)
        self.assertIn("return Math.max(this.effective(), this.ringOn ? 1 : 0, !isTvMetrics() && this.previewRingOn ? 1 : 0);", patched)
        self.assertIn("private effective(): number {\n    return Math.max(effectiveFocusPercent(this.focusPercent, this.activeRailFactor), isTvMetrics() && this.previewRingOn ? 1 : 0);", patched)
        self.assertIn(".opacity(this.visualFocus())", patched)
        self.assertNotIn(".border({ width: isTvMetrics() ? 0 : 3", patched)
        self.assertIn("previewCardMoved(this.previewCardEntry, area);", patched)
        self.assertNotIn("previewRingOn", poster)  # production source is untouched
