# Preview-only, run after patch_route.py (never committed): the parity state for the suite driver. Cards and nav tiles report their focus,
# and the route poll also reports the top route name (and Library kind). Usage: patch_state.py <ets-root> (clients/harmony/entry/src/main/ets copy).
import re, sys

def edit(rel, fn):
    p = ROOT + '/' + rel
    with open(p, encoding='utf-8') as source:
        s = source.read()
    patched = apply_once(s, fn)
    if patched == s:
        return
    with open(p, 'w', encoding='utf-8') as target:
        target.write(patched)

def apply_once(s, fn):
    if 'PreviewState' in s:
        return s
    return fn(s)

def card(s):
    s = s.replace("import { image } from '@kit.ImageKit';", "import { image } from '@kit.ImageKit';\nimport { previewRegisterCard, previewUnregisterCard, previewCardMoved, previewCardVisible, reportCardFocus, previewReport, reportDetailLayoutStageForScope, reportDetailRowImageStageForScope, reportDetailEpisodeCardAreaForMeasurement } from '../../util/PreviewState';", 1)
    s = s.replace("  @Prop artwork: image.PixelMap | undefined = undefined;", "  @Prop previewRoute: string = '';\n  @Prop previewWorkId: string = '';\n  @Prop previewRowId: string = '';\n  @Prop previewGeneration: number = 0;\n  @Prop previewRailId: string = '';\n  @Prop previewOccurrence: number = -1;\n  @Prop @Watch('previewArtworkUpdated') artwork: image.PixelMap | undefined = undefined;", 1)
    life = "  private longPressFired: boolean = false;\n"
    assert s.count(life) == 1
    s = s.replace(life, life + "  @State previewRingOn: boolean = false;\n  private previewCardEntry: number = -1;\n  aboutToAppear(): void {\n    this.previewCardEntry = previewRegisterCard((on: boolean): void => { this.previewRingOn = on; });\n  }\n  aboutToDisappear(): void {\n    previewUnregisterCard(this.previewCardEntry);\n  }\n", 1)
    focus = "return effectiveFocusPercent(this.focusPercent, this.activeRailFactor);"
    assert s.count(focus) == 1
    s = s.replace(focus, "return Math.max(effectiveFocusPercent(this.focusPercent, this.activeRailFactor), isTvMetrics() && this.previewRingOn ? 1 : 0);", 1)
    ring = "return Math.max(this.effective(), this.ringOn ? 1 : 0);"
    assert s.count(ring) == 1
    s = s.replace(ring, "return Math.max(this.effective(), this.ringOn ? 1 : 0, !isTvMetrics() && this.previewRingOn ? 1 : 0);", 1)
    image_ctor = re.compile(r"(?m)^(?P<indent>[ \t]*)Image\(this\.artwork\)\n")
    assert len(list(image_ctor.finditer(s))) == 1
    image_hooks = """            .onAppear(() => { previewReport('dbg=' + encodeURIComponent('img+' + this.title)); reportDetailRowImageStageForScope(this.previewRoute, this.previewWorkId, this.previewRowId, this.previewGeneration, 'poster-render-artwork-present'); reportDetailRowImageStageForScope(this.previewRoute, this.previewWorkId, this.previewRowId, this.previewGeneration, 'image-source'); })
            .onComplete(() => { previewReport('dbg=' + encodeURIComponent('poster-image-complete')); previewReport('dbg=' + encodeURIComponent('done+' + this.title)); reportDetailRowImageStageForScope(this.previewRoute, this.previewWorkId, this.previewRowId, this.previewGeneration, 'on-complete'); })
            .onError(() => { previewReport('dbg=' + encodeURIComponent('poster-image-error')); previewReport('dbg=' + encodeURIComponent('fail+' + this.title)); reportDetailRowImageStageForScope(this.previewRoute, this.previewWorkId, this.previewRowId, this.previewGeneration, 'on-error'); })
"""
    s = image_ctor.sub(lambda match: match.group(0) + image_hooks, s, count=1)
    # The app already has its own Image.onAreaChange (a second one would replace it, or be replaced by it): run the preview report inside it.
    own_area = "            .onAreaChange((_oldArea: Area, _area: Area) => { this.onArtworkAreaChanged(); })\n"
    assert s.count(own_area) == 1, 'PosterCard Image.onAreaChange not found exactly once'
    area_report = "reportDetailRowImageStageForScope(this.previewRoute, this.previewWorkId, this.previewRowId, this.previewGeneration, Number(area.width) > 0 && Number(area.height) > 0 ? 'image-area-positive' : 'image-area-zero'); if (this.previewRoute === 'Detail' && this.previewWorkId.length > 0 && this.previewRowId.length > 0 && this.previewRailId.length > 0 && this.previewOccurrence >= 0) { reportDetailEpisodeCardAreaForMeasurement(this.getUIContext(), this.previewRoute, this.previewWorkId, this.previewRowId, this.previewGeneration, this.previewRailId, this.previewOccurrence, this.imageMeasurementId, area); }"
    s = s.replace(own_area, "            .onAreaChange((_oldArea: Area, area: Area) => { " + area_report + " this.onArtworkAreaChanged(); })\n", 1)
    old = "      this.setFocused(true);\n      this.onFocused();\n"
    assert old in s
    s = s.replace(old, old + "      reportCardFocus(this.title, this.subtitle);\n", 1)
    s = s.replace("    .focusable(true)\n    .onFocus(() => {\n      this.setFocused(true);\n      this.onFocused();", "    .focusable(true)\n    .id('pcard')\n    .focusOnTouch(true)\n    .onFocus(() => {\n      this.setFocused(true);\n      this.onFocused();", 1)
    s = s.replace("          Skeleton({ blockWidth: this.cardWidth, blockHeight: this.cardHeight, radius: this.resolvedArtworkRadius() })", "          Skeleton({ blockWidth: this.cardWidth, blockHeight: this.cardHeight, radius: this.resolvedArtworkRadius() })\n            .onAppear(() => { previewReport('img=1'); previewReport('dbg=' + encodeURIComponent('skel+' + this.title)); reportDetailRowImageStageForScope(this.previewRoute, this.previewWorkId, this.previewRowId, this.previewGeneration, 'poster-render-artwork-undefined'); })\n            .onDisAppear(() => { previewReport('img=-1'); previewReport('dbg=' + encodeURIComponent('skel-' + this.title)); })", 1)
    s = s.replace("      .width(this.cardWidth)\n      .height(this.cardHeight)\n      .clip(true)", "      .width(this.cardWidth)\n      .height(this.cardHeight)\n      .onAreaChange((_old: Area, area: Area) => { reportDetailLayoutStageForScope(this.previewRoute, this.previewWorkId, this.previewGeneration, 'poster-card-art-area', 0, Number(area.width), Number(area.height)); })\n      .clip(true)", 1)
    s = s.replace("    .width(this.cardWidth)\n    .alignItems(HorizontalAlign.Start)", "    .width(this.cardWidth)\n    .onAreaChange((_old: Area, area: Area) => { previewCardMoved(this.previewCardEntry, area); reportDetailLayoutStageForScope(this.previewRoute, this.previewWorkId, this.previewGeneration, 'poster-card-root-area', 0, Number(area.width), Number(area.height)); })\n    .onVisibleAreaChange([0.0, 0.2], (_isVisible: boolean, ratio: number) => { previewCardVisible(this.previewCardEntry, ratio > 0.1); })\n    .alignItems(HorizontalAlign.Start)", 1)
    build_forms = (
        "  build() {\n\n    Column({ space: Spacing.xs }) {",
        "  build() {\n\n    Column({ space: this.episodeCaption.length > 0 ? 0 : Spacing.xs }) {",
    )
    matching_build_forms = [build for build in build_forms if build in s]
    assert len(matching_build_forms) == 1, "expected exactly one supported PosterCard build Column form"
    build = matching_build_forms[0]
    report = """  private previewArtworkUpdated(): void {
    const stage = this.artwork === undefined ? 'poster-artwork-prop-undefined' : 'poster-artwork-prop-present';
    reportDetailRowImageStageForScope(this.previewRoute, this.previewWorkId, this.previewRowId, this.previewGeneration, stage);
  }

"""
    s = s.replace(build, report + build, 1)
    return s.replace("    .onClick(() => {\n      if (this.longPressFired) {", "    .onClick(() => {\n      reportCardFocus('click:' + this.title, '');\n      if (this.longPressFired) {", 1)

def nav(s):
    i = s.index("import ")
    s = s[:i] + "import { reportNavFocus } from '../../util/PreviewState';\n" + s[i:]
    old = "    .onFocus(() => {\n      this.setFocused(true);\n    })\n"
    assert old in s
    return s.replace(old, "    .focusOnTouch(true)\n    .onFocus(() => {\n      this.setFocused(true);\n      reportNavFocus(this.item.label);\n    })\n", 1)

def index(s):
    s = s.replace("import { http } from '@kit.NetworkKit';", "import { http } from '@kit.NetworkKit';\nimport { previewFocusFirstCard, previewReport, reportPreviewRoute, setPreviewRouteContext } from '../util/PreviewState';", 1)
    old = "  private previewPollOnce(): void {\n"
    assert old in s
    report = """  private previewReportState(): void {
    const names: string[] = this.navPathStack.getAllPathName();
    if (names.length === 0) {
      return;
    }
    const top: string = names[names.length - 1];
    let kind: string = '';
    let workId: string = '';
    if (top === 'Library') {
      kind = (this.navPathStack.getParamByIndex(names.length - 1) as PreviewRouteParams).kind;
    } else if (top === 'Detail') {
      workId = (this.navPathStack.getParamByIndex(names.length - 1) as PreviewDetailParams).workId;
    }
    reportPreviewRoute(top, kind, workId);
  }

"""
    return s.replace(old, report + old + "    this.previewReportState();\n", 1)

def home(s):
    s = s.replace("import { image } from '@kit.ImageKit';", "import { image } from '@kit.ImageKit';\nimport { previewReport } from '../util/PreviewState';", 1)
    old = "    if (result.kind === 'ok') {\n      setItems(patchCardArtwork(getItems(), workId, result.value));"
    assert old in s
    return s.replace(old, "    previewReport('dbg=' + encodeURIComponent('home-card-artwork-' + result.kind));\n" + old, 1)

def profiles(s):
    s = "import { previewReport } from '../util/PreviewState';\n" + s
    old = "      this.profiles = result.value;\n"
    assert s.count(old) == 1
    report = "      const currentProfile = result.value.find((profile: AvailableProfileResponse): boolean => profile.is_current);\n      if (currentProfile !== undefined) { previewReport('auth=' + encodeURIComponent(currentProfile.id) + '&auth_current=1'); }\n"
    return s.replace(old, old + report, 1)

def detail(s):
    s = s.replace("import { PosterCard } from '../design/components/PosterCard';", "import { PosterCard } from '../design/components/PosterCard';\nimport { setPreviewRouteContext, currentPreviewRouteGeneration, reportDetailLayoutStageForScope, reportDetailAreaGeometryForScope, captureDetailRowImageContext, reportDetailRowImageStage, reportDetailImagePayloadScope, reportDetailEpisodeTargetForScope, reportDetailEpisodeCardContainerAreaForScope, reportDetailSeriesTargetCardVisibilityForScope, reportDetailSeriesTargetAreaSampleForScope, reportDetailPreviewGenerationScope, beginPreviewDetailLoad, reportPreviewDetailLoad } from '../util/PreviewState';", 1)
    # The Previewer may report Area lengths as strings ("12vp"): read them, and count the type when one is neither.
    len_before = """function detailAreaLengthToVp(value: Length | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  return value;
}"""
    assert s.count(len_before) <= 1
    len_after = """function detailAreaLengthToVp(value: Length | undefined): number | null {
  if (typeof value === 'string') {
    const parsed: number = Number(value.endsWith('vp') ? value.slice(0, value.length - 2) : value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    previewReport('dbg=' + encodeURIComponent('len-' + typeof value));
    return null;
  }
  return value;
}"""
    s = s.replace(len_before, len_after, 1)
    # The Previewer reports the page Scroll's Area once, at 0 x 0, and never again, so the page rectangle never becomes measurable
    # there: use the Scroll's declared position and size (the same constants its position/width/height use).
    page_before = """    const rect = detailFocusRectForArea(area);
    if (rect === null) {
      this.measuredSeriesAreaRects.set(pageId, null);
      return;
    }
    this.measuredSeriesAreaRects.set(pageId, rect);
    this.tryInitialEpisodeFocus(null, null, workId, generation);"""
    page_after = """    const measured = detailFocusRectForArea(area);
    const rect: EpisodeFocusRect = measured !== null ? measured : {
      left: tv(RIGHT_COLUMN_X), top: tv(SERIES_COLUMN_TOP), width: tv(RIGHT_COLUMN_WIDTH), height: tv(SERIES_COLUMN_HEIGHT),
    };
    this.measuredSeriesAreaRects.set(pageId, rect);
    this.tryInitialEpisodeFocus(null, null, workId, generation);"""
    assert s.count(page_before) <= 1
    s = s.replace(page_before, page_after, 1)
    api_await = "    const detailResult = await getWorkDetail(workId);"
    assert s.count(api_await) == 1
    s = s.replace(api_await, """    const detailResult = await getWorkDetail(workId);
    const previewResultCategory = detailResult.kind;
    const previewStatus = detailResult.kind === 'network_failure' ? -1 : detailResult.status;
    const previewErrorCategory = detailResult.kind === 'network_failure' ? detailResult.reason :
      detailResult.kind === 'http_failure' ? detailResult.envelope.kind : '';
    reportPreviewDetailLoad(workId, previewLoadGeneration, previewLoadSequence, 'api-result', 'loading', previewResultCategory,
      previewStatus, previewErrorCategory);""", 1)
    failure_return = """      return;
    }

    const detail = detailResult.value;
    this.detail = detail;"""
    assert s.count(failure_return) == 1
    s = s.replace(failure_return, """      return;
    }

    const detail = detailResult.value;
    this.detail = detail;""", 1)
    area_interface = """interface DetailSeasonRowArea {
  top: number;
  height: number;
}
"""
    assert s.count(area_interface) == 1
    s = s.replace(area_interface, area_interface + """interface PreviewDetailSeasonRowArea {
  top: number;
  width: number;
  height: number;
}
""", 1)
    artwork_store = "  @ObjectLink artworkStore: DetailArtworkStore;\n"
    assert artwork_store in s
    s = s.replace(artwork_store, artwork_store + "  @Prop previewRoute: string = '';\n  @Prop previewWorkId: string = '';\n  @Prop previewRowId: string = '';\n  @Prop previewGeneration: number = 0;\n  @Prop previewRailId: string = '';\n  @Prop previewOccurrence: number = -1;\n", 1)
    card_area_callback = "      .onAreaChange((_oldArea: Area, area: Area) => { this.onCardArea(area); })"
    assert s.count(card_area_callback) == 1
    s = s.replace(card_area_callback, "      .onAreaChange((_oldArea: Area, area: Area) => { this.onCardArea(area); reportDetailAreaGeometryForScope(this.previewRoute, this.previewWorkId, this.previewGeneration, area); })", 1)
    measurement_id_method = """  private seriesMeasurementId(kind: string, workId: string, generation: number, railId: string,
                              episodeId: string = '', occurrence: number = -1): string {
    return seriesDetailMeasurementId(kind, workId, generation, railId, episodeId, occurrence);
  }
"""
    assert s.count(measurement_id_method) == 1, "expected source Detail measurement ID helper"
    s = s.replace(measurement_id_method, measurement_id_method.replace(
        "seriesDetailMeasurementId(kind, workId, generation, railId, episodeId, occurrence)",
        "seriesDetailMeasurementId(kind, workId, this.previewScopeGeneration, railId, episodeId, occurrence)"), 1)
    focus_gate_field = "  private episodeFocusGate: EpisodeFocusGate = new EpisodeFocusGate();\n"
    assert focus_gate_field in s
    s = s.replace(focus_gate_field, focus_gate_field + "  private previewLoadSequence: number = 0;\n  private previewLoadGeneration: number = 0;\n  private previewScopeGeneration: number = 0;\n  private previewCardAreaRouteGenerations: Map<string, number> = new Map();\n  private previewSeriesFocusRequestCount: number = 0;\n  private previewReportedSeriesPrerequisites: Map<string, number> = new Map();\n  private previewSeasonRowAreas: Map<string, PreviewDetailSeasonRowArea> = new Map();\n", 1)
    other_focus_method = """  private noteOtherDetailFocus(workId: string, generation: number): void {
    if (workId !== this.workId || generation !== this.seriesFocusGeneration) {
      return;
    }
    // Framework-seeded focus is passive; key and click handlers cancel the initial request.
    this.seriesFocusedRowIsTarget = false;
    this.episodeFocusGate.recordCurrentFocus('', this.resumeTargetEpisodeId());
    this.tryInitialEpisodeFocus(null, null, workId, generation);
  }
"""
    assert s.count(other_focus_method) == 1
    s = s.replace(other_focus_method, other_focus_method.replace(
        "    this.seriesFocusedRowIsTarget = false;\n",
        "    this.seriesFocusedRowIsTarget = false;\n    reportDetailLayoutStageForScope('Detail', this.workId, this.previewScopeGeneration, 'series-focused-row-is-target', 0, -1, -1);\n"), 1)
    resume_plan_assignment = "    this.resumePlan = result.value;\n"
    assert s.count(resume_plan_assignment) == 1
    s = s.replace(resume_plan_assignment, resume_plan_assignment + """    this.reportPreviewStoredTargetSeasonArea();
    const previewDetail = this.detail;
    const previewTargetPresent = previewDetail !== null && previewDetail.work.kind === 'series' &&
      hasSeriesResumeTarget(previewDetail, result.value) && result.value.target !== undefined && result.value.target !== null;
    this.reportPreviewSeriesPrerequisite('resume-plan-loaded', 1);
    this.reportPreviewSeriesPrerequisite('target-present', previewTargetPresent ? 1 : 0);
    this.reportPreviewSeriesPrerequisite('focus-pending', this.episodeFocusGate.isPending() ? 1 : 0);
    this.reportPreviewSeriesPrerequisite('focus-suppressed', this.episodeFocusSuppressed ? 1 : 0);
    this.reportPreviewSeriesPrerequisite('focus-request-count', this.previewSeriesFocusRequestCount);
    if (previewTargetPresent && result.value.target !== undefined && result.value.target !== null) {
      reportDetailEpisodeTargetForScope('Detail', this.workId, result.value.target.episode_id, this.previewScopeGeneration);
    }
""", 1)
    resume_plan_failure = """    if (result.kind !== 'ok') {
      return;
    }
"""
    assert s.count(resume_plan_failure) == 1
    s = s.replace(resume_plan_failure, """    if (result.kind !== 'ok') {
      this.reportPreviewSeriesPrerequisite('resume-plan-loaded', 0);
      this.reportPreviewSeriesPrerequisite('target-present', 0);
      this.reportPreviewSeriesPrerequisite('target-in-any-rail', 0);
      return;
    }
""", 1)
    target_rail_block = """      const targetRail = this.rails.find((rail: DetailRail): boolean =>
        rail.items.findIndex((item: DetailRow): boolean => item.id === targetEpisodeId) >= 0
      );
      if (targetRail !== undefined) {
"""
    assert s.count(target_rail_block) == 1
    s = s.replace(target_rail_block, """      const targetRail = this.rails.find((rail: DetailRail): boolean =>
        rail.items.findIndex((item: DetailRow): boolean => item.id === targetEpisodeId) >= 0
      );
      this.reportPreviewSeriesPrerequisite('target-in-any-rail', targetRail !== undefined ? 1 : 0);
      this.reportPreviewSeriesPrerequisite('target-card-mounted',
        this.mountedSeriesEpisodeIds.indexOf(targetEpisodeId) >= 0 ? 1 : 0);
      if (targetRail !== undefined) {
""", 1)
    # The watchlist pill is blank until its resolve returns: count the pending resolve with the placeholders (img=+1/-1).
    resolve_old = "    const result = await resolveTitle(snapshotFromWork(work));\n    if (result.kind === 'ok') {\n      this.watchlistKey = result.value.title.title_key;\n      this.listed = result.value.in_watchlist === true;\n    } else {\n      this.listed = false;\n    }\n"
    assert s.count(resolve_old) == 1
    s = s.replace("import { PosterCard } from '../design/components/PosterCard';", "import { PosterCard } from '../design/components/PosterCard';\nimport { previewReport } from '../util/PreviewState';", 1)
    s = s.replace(resolve_old, "    previewReport('img=1');\n" + resolve_old + "    previewReport('img=-1');\n", 1)
    load_detail = "  private async loadDetail(): Promise<void> {\n"
    assert load_detail in s
    s = s.replace(load_detail, load_detail + "    setPreviewRouteContext('Detail', '', this.workId);\n    this.previewScopeGeneration = currentPreviewRouteGeneration();\n    this.previewLoadSequence = beginPreviewDetailLoad(this.workId);\n    this.previewLoadGeneration = currentPreviewRouteGeneration();\n    const previewLoadSequence: number = this.previewLoadSequence;\n    const previewLoadGeneration: number = this.previewLoadGeneration;\n    this.previewCardAreaRouteGenerations = new Map();\n    this.previewSeriesFocusRequestCount = 0;\n    this.previewReportedSeriesPrerequisites = new Map();\n    this.previewSeasonRowAreas = new Map();\n", 1)
    item_area_reporter_start = s.index("  private seriesRailItemAreaReporter(")
    item_area_reporter_end = s.index("  private seriesCardArtworkAreaReporter(", item_area_reporter_start)
    item_area_reporter = s[item_area_reporter_start:item_area_reporter_end]
    area_callback = """    return (itemId: string, index: number, area: Area, railOffset: number): void => {
      this.seriesCardAreaChanged(railId, itemId, index, workId, generation, area, railOffset);"""
    assert item_area_reporter.count(area_callback) == 1
    item_area_reporter = item_area_reporter.replace(area_callback, """    return (itemId: string, index: number, area: Area, railOffset: number): void => {
      const livePreviewGeneration = currentPreviewRouteGeneration();
      if (!reportDetailPreviewGenerationScope(workId, this.previewScopeGeneration, livePreviewGeneration)) {
        return;
      }
      this.seriesCardAreaChanged(railId, itemId, index, workId, generation, area, railOffset);""", 1)
    s = s[:item_area_reporter_start] + item_area_reporter + s[item_area_reporter_end:]
    focus_request = """    if (decision === 'request' && this.episodeFocusGate.beginRequest()) {
      const issued = issueEpisodeFocusRequest((): void => {
        this.getUIContext().getFocusController().requestFocus(seriesEpisodeFocusId(episodeId));
      });
      if (!issued) {
        this.episodeFocusGate.rollbackRequest();
      }
    }"""
    assert s.count(focus_request) == 1
    s = s.replace(focus_request, """    if (decision === 'request' && this.episodeFocusGate.beginRequest()) {
      this.previewSeriesFocusRequestCount += 1;
      reportDetailLayoutStageForScope('Detail', this.workId, this.previewScopeGeneration,
        'series-focus-request-count', this.previewSeriesFocusRequestCount, -1, -1);
      const issued = issueEpisodeFocusRequest((): void => {
        this.getUIContext().getFocusController().requestFocus(seriesEpisodeFocusId(episodeId));
      });
      reportDetailLayoutStageForScope('Detail', this.workId, this.previewScopeGeneration,
        'series-focus-request-issued', issued ? 1 : 0, -1, -1);
      if (!issued) {
        reportDetailLayoutStageForScope('Detail', this.workId, this.previewScopeGeneration,
          'series-focus-request-result', 0, -1, -1);
        this.episodeFocusGate.rollbackRequest();
      }
    }""", 1)
    focus_claim = "    const decision = this.episodeFocusGate.claim(episodeId, mounted, visible);\n"
    assert s.count(focus_claim) == 1
    s = s.replace(focus_claim, focus_claim +
                  "    this.reportPreviewSeriesPrerequisite('focus-pending', this.episodeFocusGate.isPending() ? 1 : 0);\n", 1)
    area_measurement = """    this.measuredSeriesAreaRects.set(measurementId, rect);
    this.measuredSeriesCardAreas.set(measurementId, {
      workId: workId,
      generation: generation,
      railId: railId,
      episodeId: episodeId,
      occurrence: occurrence,
      pageOffset: pageOffset,
      railOffset: railOffset,
      capturedAtMs: Date.now(),
    });"""
    assert s.count(area_measurement) == 1
    s = s.replace(area_measurement, area_measurement + "\n    this.previewCardAreaRouteGenerations.set(measurementId, this.previewScopeGeneration);\n    reportDetailEpisodeCardContainerAreaForScope('Detail', workId, episodeId, this.previewScopeGeneration,\n      rect.left, rect.top, rect.width, rect.height, this.getUIContext().vp2px(1));", 1)
    offset_guard = """    if (currentRailOffset === null || !Number.isFinite(currentRailOffset)) {
      return;
    }
"""
    assert s.count(offset_guard) == 1
    s = s.replace(offset_guard, "", 1)
    current_geometry_guard = """    if (cardMeasurement === undefined || cardMeasurement === null || card === undefined || card === null ||
        rail === undefined || rail === null || page === undefined || page === null ||
        !Number.isFinite(pageOffset) ||
        !seriesEpisodeAreaSampleMatchesTarget(
          cardMeasurement, workId, generation, targetRailId, episodeId, occurrence, pageOffset, currentRailOffset
        )) {
      return;
    }
    const mounted = appeared || hasPositiveEpisodeAreaSample(
      card, cardMeasurement.pageOffset, cardMeasurement.railOffset
    );
    const visible = hasPositiveEpisodeVisibleArea(card, rail, page);"""
    assert s.count(current_geometry_guard) == 1
    area_sample_report = """    previewReport('dbg=' + encodeURIComponent('tgt-guard-' + (cardMeasurement === undefined || cardMeasurement === null ? 'm0' : 'm1') +
      (card === undefined || card === null ? 'c0' : 'c1') + (rail === undefined || rail === null ? 'r0' : 'r1') +
      (page === undefined || page === null ? 'p0' : 'p1') + (Number.isFinite(pageOffset) ? 'o1' : 'o0') +
      (cardMeasurement !== undefined && cardMeasurement !== null && seriesEpisodeAreaSampleMatchesTarget(cardMeasurement,
        workId, generation, targetRailId, episodeId, occurrence, pageOffset, currentRailOffset) ? 's1' : 's0')));
    if (cardMeasurement !== undefined) {
      const previewAreaRouteGeneration = this.previewCardAreaRouteGenerations.get(measurementId);
      const previewAreaScopeMatches = previewAreaRouteGeneration !== undefined &&
        reportDetailPreviewGenerationScope(workId, previewAreaRouteGeneration, currentPreviewRouteGeneration());
      const areaFresh = cardMeasurement !== null && card !== undefined && card !== null &&
        hasPositiveEpisodeAreaSample(card, cardMeasurement.pageOffset, cardMeasurement.railOffset) &&
        currentRailOffset !== null && Number.isFinite(currentRailOffset) && Number.isFinite(pageOffset) &&
        seriesEpisodeAreaSampleMatchesTarget(cardMeasurement, workId, generation, targetRailId, episodeId,
          occurrence, pageOffset, currentRailOffset) && previewAreaScopeMatches;
      if (cardMeasurement !== null && card !== undefined && card !== null &&
          previewAreaRouteGeneration !== undefined) {
        reportDetailSeriesTargetAreaSampleForScope('Detail', workId, previewAreaRouteGeneration, areaFresh ? 1 : 0,
          card.width, card.height, cardMeasurement.pageOffset, cardMeasurement.railOffset,
          cardMeasurement.capturedAtMs);
      }
    }
"""
    current_geometry_guard_scoped = current_geometry_guard.replace(
        "        !Number.isFinite(pageOffset) ||",
        "        currentRailOffset === null || !Number.isFinite(currentRailOffset) ||\n        !Number.isFinite(pageOffset) ||", 1)
    s = s.replace(current_geometry_guard, area_sample_report + current_geometry_guard_scoped + """
    const intersectionLeft = Math.max(card.left, rail.left, page.left);
    const intersectionTop = Math.max(card.top, rail.top, page.top);
    const intersectionRight = Math.min(card.left + card.width, rail.left + rail.width, page.left + page.width);
    const intersectionBottom = Math.min(card.top + card.height, rail.top + rail.height, page.top + page.height);
    reportDetailSeriesTargetCardVisibilityForScope('Detail', workId, this.previewScopeGeneration, visible ? 1 : 0,
      Math.max(0, intersectionRight - intersectionLeft), Math.max(0, intersectionBottom - intersectionTop),
      pageOffset, currentRailOffset, 1);""", 1)
    readiness_methods = """  private reportPreviewSeriesPrerequisite(stage: string, value: number): void {
    const detail = this.detail;
    if (detail === null || detail.work.kind !== 'series') {
      return;
    }
    const previous = this.previewReportedSeriesPrerequisites.get(stage);
    if (previous === value) {
      return;
    }
    this.previewReportedSeriesPrerequisites.set(stage, value);
    reportDetailLayoutStageForScope('Detail', this.workId, this.previewScopeGeneration, stage, value, -1, -1);
  }

"""
    readiness_insert_at = "  private tryInitialEpisodeFocus(railId: string | null = null"
    assert s.count(readiness_insert_at) == 1
    s = s.replace(readiness_insert_at, readiness_methods + readiness_insert_at, 1)
    cancel_focus = """  private cancelInitialEpisodeFocus(): void {
    this.episodeFocusGate.cancel();
    this.episodeFocusSuppressed = true;
    this.seriesFocusedRowIsTarget = false;
  }
"""
    assert s.count(cancel_focus) == 1
    s = s.replace(cancel_focus, cancel_focus.replace(
        "    this.seriesFocusedRowIsTarget = false;\n",
        "    this.seriesFocusedRowIsTarget = false;\n    this.reportPreviewSeriesPrerequisite('focus-suppressed', 1);\n    reportDetailLayoutStageForScope('Detail', this.workId, this.previewScopeGeneration, 'series-focused-row-is-target', 0, -1, -1);\n"), 1)
    mount_method = """  private seriesEpisodeCardAppeared(railId: string, episodeId: string, occurrence: number): void {
    if (this.mountedSeriesEpisodeIds.indexOf(episodeId) < 0) {
      this.mountedSeriesEpisodeIds.push(episodeId);
    }
    this.tryInitialEpisodeFocus(railId, episodeId, this.workId, this.seriesFocusGeneration, occurrence);
  }
"""
    assert s.count(mount_method) == 1
    s = s.replace(mount_method, """  private seriesEpisodeCardAppeared(railId: string, episodeId: string, occurrence: number): void {
    if (this.mountedSeriesEpisodeIds.indexOf(episodeId) < 0) {
      this.mountedSeriesEpisodeIds.push(episodeId);
    }
    const plan = this.resumePlan;
    if (plan !== null && plan.target !== undefined && plan.target !== null && plan.target.episode_id === episodeId) {
      this.reportPreviewSeriesPrerequisite('target-card-mounted', 1);
      reportDetailEpisodeTargetForScope('Detail', this.workId, episodeId, this.previewScopeGeneration);
    }
    this.tryInitialEpisodeFocus(railId, episodeId, this.workId, this.seriesFocusGeneration, occurrence);
  }
""", 1)
    s = s.replace("    this.targetSeriesSeasonCentered = true;\n    this.seriesStackScroller.scrollTo({", "    this.reportPreviewSeriesPrerequisite('target-season-scroll-requested', 1);\n    reportDetailEpisodeTargetForScope('Detail', this.workId, targetEpisodeId, this.previewScopeGeneration);\n    this.targetSeriesSeasonCentered = true;\n    this.seriesStackScroller.scrollTo({", 1)
    s = s.replace("    this.targetSeriesEpisodeCentered = true;\n    this.tryInitialEpisodeFocus();", "    this.reportPreviewSeriesPrerequisite('target-episode-scroll-requested', 1);\n    reportDetailEpisodeTargetForScope('Detail', this.workId, targetEpisodeId, this.previewScopeGeneration);\n    this.targetSeriesEpisodeCentered = true;\n    this.tryInitialEpisodeFocus();", 1)
    target_season_method = """  private reportPreviewTargetSeasonMeasurements(rowTopVp: number, rowWidthVp: number,
                                                 rowHeightVp: number): void {
    reportDetailLayoutStageForScope('Detail', this.workId, this.previewScopeGeneration,
      'series-target-season-row-area', 1, rowWidthVp, rowHeightVp);
    reportDetailLayoutStageForScope('Detail', this.workId, this.previewScopeGeneration,
      'series-target-season-centre-delta-vp', rowTopVp + rowHeightVp / 2 - tv(SERIES_COLUMN_HEIGHT) / 2,
      rowWidthVp, rowHeightVp);
  }

  private rememberPreviewSeasonArea(rail: DetailRail, area: Area): void {
    const positionY = area.position.y;
    if (positionY === undefined || positionY === null) {
      return;
    }
    const rowTopVp = detailLengthToVp(positionY);
    const rowHeightVp = detailLengthToVp(area.height);
    const rowWidthVp = detailLengthToVp(area.width);
    if (rowHeightVp <= 0 || rowWidthVp <= 0) {
      return;
    }
    this.previewSeasonRowAreas.set(rail.id, { top: rowTopVp, width: rowWidthVp, height: rowHeightVp });
  }

  private reportPreviewTargetSeasonArea(rail: DetailRail, area: Area): void {
    const detail = this.detail;
    const plan = this.resumePlan;
    if (detail === null || detail.work.kind !== 'series' || plan === null ||
        plan.target === undefined || plan.target === null) {
      return;
    }
    const targetEpisodeId = plan.target.episode_id;
    if (rail.items.findIndex((item: DetailRow): boolean => item.id === targetEpisodeId) < 0) {
      return;
    }
    const rowArea = this.previewSeasonRowAreas.get(rail.id);
    if (rowArea !== undefined) {
      this.reportPreviewTargetSeasonMeasurements(rowArea.top, rowArea.width, rowArea.height);
    }
  }

  private reportPreviewStoredTargetSeasonArea(): void {
    const detail = this.detail;
    const plan = this.resumePlan;
    if (detail === null || detail.work.kind !== 'series' || plan === null ||
        plan.target === undefined || plan.target === null) {
      return;
    }
    const targetEpisodeId = plan.target.episode_id;
    const rail = this.rails.find((candidate: DetailRail): boolean =>
      candidate.items.findIndex((item: DetailRow): boolean => item.id === targetEpisodeId) >= 0);
    if (rail === undefined) {
      return;
    }
    const rowArea = this.previewSeasonRowAreas.get(rail.id);
    if (rowArea === undefined) {
      return;
    }
    this.reportPreviewTargetSeasonMeasurements(rowArea.top, rowArea.width, rowArea.height);
  }

"""
    target_season_insert_at = "  private seriesEpisodeIndexPositioned(rail: DetailRail): void {\n"
    assert s.count(target_season_insert_at) == 1
    s = s.replace(target_season_insert_at, target_season_method + target_season_insert_at, 1)
    focused_method = """  private seriesEpisodeCardFocused(episodeId: string): void {
    const targetEpisodeId = this.resumeTargetEpisodeId();
    this.seriesFocusedRowIsTarget = isSeriesEpisodeTargetFocused(episodeId, targetEpisodeId);
    this.episodeFocusGate.recordCurrentFocus(episodeId, targetEpisodeId);
  }
"""
    assert s.count(focused_method) == 1
    s = s.replace(focused_method, focused_method.replace(
        "    this.episodeFocusGate.recordCurrentFocus(episodeId, targetEpisodeId);\n",
        "    this.episodeFocusGate.recordCurrentFocus(episodeId, targetEpisodeId);\n    const focusValue = this.seriesFocusedRowIsTarget ? 1 : 0;\n    reportDetailLayoutStageForScope('Detail', this.workId, this.previewScopeGeneration, 'series-focused-row-is-target', focusValue, -1, -1);\n    if (focusValue === 1) {\n      reportDetailLayoutStageForScope('Detail', this.workId, this.previewScopeGeneration, 'series-focus-request-result', 1, -1, -1);\n    }\n"), 1)
    card_variant = "      variant: this.variant,\n"
    assert card_variant in s
    s = s.replace(card_variant, card_variant + "      previewRoute: this.previewRoute,\n      previewWorkId: this.previewWorkId,\n      previewRowId: this.previewRowId,\n      previewGeneration: this.previewGeneration,\n", 1)
    forwarded_generation = "      previewGeneration: this.previewGeneration,\n"
    assert s.count(forwarded_generation) == 1
    s = s.replace(forwarded_generation, forwarded_generation + "      previewRailId: this.previewRailId,\n      previewOccurrence: this.previewOccurrence,\n", 1)
    wrapper_artwork_store = "  @ObjectLink artworkStore: DetailArtworkStore;\n"
    assert s.count(wrapper_artwork_store) == 1
    series_episode_card = "      episodeNumberOverlay: (item as DetailRow).episodeNumberOverlay ?? '',\n"
    assert s.count(series_episode_card) == 1
    artwork_store_arg = re.compile(r"(?m)^(?P<indent>\s*)artworkStore: this\.artworkStore,\n(?P=indent)rowId: \(item as DetailRow\)\.id,\n")
    matches = artwork_store_arg.findall(s)
    assert len(matches) == 6
    def add_preview_context(match):
        indent = match.group('indent')
        return match.group(0) + indent + "previewRoute: 'Detail',\n" + indent + "previewWorkId: this.workId,\n" + indent + "previewRowId: (item as DetailRow).id,\n" + indent + "previewGeneration: currentPreviewRouteGeneration(),\n"
    s = artwork_store_arg.sub(add_preview_context, s)
    episode_item_pattern = re.compile(
        r"(?s)  private seriesEpisodeItem\(item: MediaRailItem, index: number, activeRailFactor: number, railId: string\): void \{.*?\n  \}(?=\n\n  /\*\* Similar-title row content)")
    direct_series_episode_item = """  private seriesEpisodeItem(item: MediaRailItem, index: number, activeRailFactor: number, railId: string): void {
    DetailRowArtworkCard({
      artworkStore: this.artworkStore,
      rowId: (item as DetailRow).id,
      previewRoute: 'Detail',
      previewWorkId: this.workId,
      previewRowId: (item as DetailRow).id,
      previewGeneration: this.previewScopeGeneration,
      previewRailId: railId,
      previewOccurrence: index,
      measurementId: this.seriesMeasurementId('card', this.workId, this.seriesFocusGeneration, railId,
        (item as DetailRow).id, index),
      imageMeasurementId: this.seriesMeasurementId('image', this.workId, this.seriesFocusGeneration, railId,
        (item as DetailRow).id, index),
      variant: 'titleEpisode',
      title: (item as DetailRow).title,
      subtitle: '',
      episodeCaption: (item as DetailRow).episodeCaption ?? '',
      episodeNumberOverlay: (item as DetailRow).episodeNumberOverlay ?? '',
      focusId: seriesEpisodeFocusId((item as DetailRow).id),
      ringOn: !isTvMetrics() && this.nextUpEpisodeId() === (item as DetailRow).id,
      unseen: this.episodeUnseen(item as DetailRow),
      cardWidth: this.seriesCardWidth(),
      cardHeight: Math.round(this.seriesCardWidth() * 9 / 16),
      activeRailFactor: activeRailFactor,
      onCardAppear: (): void => { this.seriesEpisodeCardAppeared(railId, (item as DetailRow).id, index); },
      onArtworkAreaChanged: this.seriesCardArtworkAreaReporter(railId, (item as DetailRow).id, index,
        this.workId, this.seriesFocusGeneration),
      onCardFocus: this.seriesEpisodeFocusReporter((item as DetailRow).id,
        this.workId, this.seriesFocusGeneration),
      onSelect: () => { this.selectRow((item as DetailRow)); },
    })
  }"""
    transformed_episode_item, count = episode_item_pattern.subn(direct_series_episode_item, s, count=1)
    assert count == 1, "expected exact seriesEpisodeItem builder for local-free preview transform"
    s = transformed_episode_item
    old = """        const thumb = await fetchMediaThumbnail(item.mediaFileId, 0);
        if (!this.artworkStore.isCurrentGeneration(generation)) {
          return;
        }
        if (thumb.kind === 'ok') {
          this.artworkStore.setArtwork(generation, item.id, thumb.value);
        }"""
    assert old in s
    new = """        const previewContext = captureDetailRowImageContext(this.workId, item.id);
        reportDetailRowImageStage(previewContext, 'source');
        reportDetailRowImageStage(previewContext, 'fetch-start');
        const thumb = await fetchMediaThumbnail(item.mediaFileId, 0);
        if (!this.artworkStore.isCurrentGeneration(generation)) {
          return;
        }
        if (thumb.kind === 'ok') {
          reportDetailRowImageStage(previewContext, 'fetch-ok');
          reportDetailRowImageStage(previewContext, 'bridge-source-ready');
          let matchingRowCount = 0;
          for (const existingRail of this.rails) {
            for (const existingRow of existingRail.items) {
              if (existingRow.id === item.id) {
                matchingRowCount += 1;
              }
            }
          }
          reportDetailRowImageStage(previewContext,
            matchingRowCount > 0 ? 'row-match-found' : 'row-match-missing');
          reportDetailImagePayloadScope(previewContext, thumb.value as Object as string);
          this.artworkStore.setArtwork(generation, item.id, thumb.value);
          const artworkStorePresent = this.artworkStore.getArtwork(item.id) !== undefined;
          reportDetailRowImageStage(previewContext,
            artworkStorePresent ? 'artwork-store-present' : 'artwork-store-absent');
          if (artworkStorePresent) {
            reportDetailRowImageStage(previewContext, 'artwork-store-updated');
          }
          reportDetailRowImageStage(previewContext, 'assigned');
        } else {
          reportDetailRowImageStage(previewContext, 'fetch-error');
        }"""
    s = s.replace(old, new, 1)
    position_callback = "  private seriesEpisodeIndexPositioned(rail: DetailRail): void {"
    assert s.count(position_callback) == 1
    preview_callback = """  private reportPreviewEpisodePositionedCallback(rail: DetailRail): void {
    const targetEpisodeId = this.resumeTargetEpisodeId();
    const capturedTargetIndex = targetEpisodeId === null ? -1 :
      rail.items.findIndex((item: DetailRow): boolean => item.id === targetEpisodeId);
    const liveRail = this.rails.find((candidate: DetailRail): boolean => candidate.id === rail.id);
    const liveTargetIndex = liveRail === undefined || targetEpisodeId === null ? -1 :
      liveRail.items.findIndex((item: DetailRow): boolean => item.id === targetEpisodeId);
    reportDetailLayoutStageForScope('Detail', this.workId, this.previewScopeGeneration,
      'target-episode-positioned-callback', 1, -1, -1);
    reportDetailLayoutStageForScope('Detail', this.workId, this.previewScopeGeneration,
      'target-episode-callback-captured-item-count', rail.items.length, -1, -1);
    reportDetailLayoutStageForScope('Detail', this.workId, this.previewScopeGeneration,
      'target-episode-callback-captured-target-found', capturedTargetIndex >= 0 ? 1 : 0, -1, -1);
    if (capturedTargetIndex >= 0) {
      reportDetailLayoutStageForScope('Detail', this.workId, this.previewScopeGeneration,
        'target-episode-callback-captured-target-index', capturedTargetIndex, -1, -1);
    }
    reportDetailLayoutStageForScope('Detail', this.workId, this.previewScopeGeneration,
      'target-episode-callback-live-rail-found', liveRail !== undefined ? 1 : 0, -1, -1);
    if (liveRail !== undefined) {
      reportDetailLayoutStageForScope('Detail', this.workId, this.previewScopeGeneration,
        'target-episode-callback-live-item-count', liveRail.items.length, -1, -1);
      reportDetailLayoutStageForScope('Detail', this.workId, this.previewScopeGeneration,
        'target-episode-callback-live-target-found', liveTargetIndex >= 0 ? 1 : 0, -1, -1);
      if (liveTargetIndex >= 0) {
        reportDetailLayoutStageForScope('Detail', this.workId, this.previewScopeGeneration,
          'target-episode-callback-live-target-index', liveTargetIndex, -1, -1);
      }
    }
  }

"""
    s = s.replace(position_callback, preview_callback + position_callback, 1)
    tv_start = s.index("  private tvRightColumn(): void {")
    tv_end = s.index("  @Builder\n  private chapterItem", tv_start)
    tv = s[tv_start:tv_end]
    old_items = re.compile(r"(?m)^(?P<indent>[ \t]*)items: rail\.items,\n(?P=indent)itemBuilder:")
    matches = list(old_items.finditer(tv))
    assert len(matches) == 1, "expected exactly one standard rail items/itemBuilder pair in Detail"
    indent = matches[0].group("indent")
    replacement = (
        indent + "items: rail.items,\n" +
        indent + "previewRoute: 'Detail',\n" +
        indent + "previewWorkId: this.workId,\n" +
        indent + "previewGeneration: currentPreviewRouteGeneration(),\n" +
        indent + "itemBuilder:"
    )
    tv = old_items.sub(lambda _match: replacement, tv, count=1)
    series_rail = "              railId: rail.id,\n              measurementId: this.seriesMeasurementId('rail', this.workId, this.seriesFocusGeneration, rail.id),\n              heading: '',\n              headingGap: 0,"
    assert tv.count(series_rail) == 1
    tv = tv.replace(series_rail, "              railId: rail.id,\n              measurementId: this.seriesMeasurementId('rail', this.workId, this.seriesFocusGeneration, rail.id),\n              previewRoute: 'Detail',\n              previewWorkId: this.workId,\n              previewGeneration: this.previewScopeGeneration,\n              heading: '',\n              headingGap: 0,", 1)
    series_rail_context = "              previewGeneration: this.previewScopeGeneration,\n              heading: '',"
    assert tv.count(series_rail_context) == 1
    tv = tv.replace(series_rail_context,
        "              previewGeneration: this.previewScopeGeneration,\n              previewTargetEpisodeId: this.resumeTargetEpisodeId() ?? '',\n              heading: '',", 1)
    position_callback_invocation = "onInitialItemPositioned: (): void => { this.seriesEpisodeIndexPositioned(rail); },"
    assert tv.count(position_callback_invocation) == 1
    tv = tv.replace(position_callback_invocation,
        "onInitialItemPositioned: (): void => { this.reportPreviewEpisodePositionedCallback(rail); this.seriesEpisodeIndexPositioned(rail); },", 1)
    season_area_callback = """          .onAreaChange((_oldArea: Area, area: Area) => {
            this.onSeriesSeasonRowAreaChanged(rail, area);
          })"""
    assert tv.count(season_area_callback) == 1
    tv = tv.replace(season_area_callback, """          .onAreaChange((_oldArea: Area, area: Area) => {
            this.rememberPreviewSeasonArea(rail, area);
            this.reportPreviewTargetSeasonArea(rail, area);
            this.onSeriesSeasonRowAreaChanged(rail, area);
          })""", 1)
    s = s[:tv_start] + tv + s[tv_end:]
    old_rails = "    const rails = buildRailsFromChildren(detail.children);\n    this.rails = rails;"
    assert old_rails in s
    s = s.replace(old_rails, old_rails + "\n    reportDetailLayoutStageForScope('Detail', this.workId, currentPreviewRouteGeneration(), 'detail-rails-count', rails.length, -1, -1);", 1)
    loading_states = """        },
      })
    } else {
      AsyncState({ kind: AsyncStateKind.Loading })"""
    assert s.count(loading_states) == 1
    s = s.replace(loading_states, """        },
      }).onAppear(() => { reportPreviewDetailLoad(this.workId, this.previewLoadGeneration,
        this.previewLoadSequence, 'render-state', 'error'); })
    } else {
      AsyncState({ kind: AsyncStateKind.Loading })
        .onAppear(() => { reportPreviewDetailLoad(this.workId, this.previewLoadGeneration,
          this.previewLoadSequence, 'render-state', 'loading'); })""", 1)
    page_shell_content = """      content: (): void => {
        this.tvContent();
      },
    })"""
    assert s.count(page_shell_content) == 1
    s = s.replace(page_shell_content, page_shell_content + """
      .onAppear(() => { reportPreviewDetailLoad(this.workId, this.previewLoadGeneration,
        this.previewLoadSequence, 'render-state', 'detail-ready'); })""", 1)
    return instrument_episode_art(s)

def replace_episode_branch(s, old, new, branch):
    count = s.count(old)
    assert count == 1, f"expected exactly one {branch} episode-art branch, found {count}"
    return s.replace(old, new, 1)

def instrument_episode_art(s):
    still = """            if (source === 'episode-still') {
              const still = await fetchEpisodeArtwork(detail.work.id, item.id, 'thumb', 540);
              if (!this.artworkStore.isCurrentGeneration(generation)) {
                return;
              }
              if (still.kind === 'ok') {
                this.artworkStore.setArtwork(generation, item.id, still.value);
                break;
              }
              continue;
            }"""
    still_instrumented = """            if (source === 'episode-still') {
              const stillContext = captureDetailRowImageContext(this.workId, item.id);
              reportDetailRowImageStage(stillContext, 'source');
              reportDetailRowImageStage(stillContext, 'fetch-start');
              const still = await fetchEpisodeArtwork(detail.work.id, item.id, 'thumb', 540);
              if (!this.artworkStore.isCurrentGeneration(generation)) {
                return;
              }
              if (still.kind === 'ok') {
                reportDetailRowImageStage(stillContext, 'fetch-ok');
                reportDetailRowImageStage(stillContext, 'bridge-source-ready');
                reportDetailImagePayloadScope(stillContext, still.value as Object as string);
                this.artworkStore.setArtwork(generation, item.id, still.value);
                const stillStored = this.artworkStore.getArtwork(item.id) !== undefined;
                reportDetailRowImageStage(stillContext, stillStored ? 'artwork-store-present' : 'artwork-store-absent');
                if (stillStored) {
                  reportDetailRowImageStage(stillContext, 'artwork-store-updated');
                }
                reportDetailRowImageStage(stillContext, 'assigned');
                break;
              }
              reportDetailRowImageStage(stillContext, 'fetch-error');
              continue;
            }"""
    s = replace_episode_branch(s, still, still_instrumented, 'episode-still')

    frame = """            if (source === 'media-thumbnail') {
              const frame = await fetchMediaThumbnail(item.mediaFileId);
              if (!this.artworkStore.isCurrentGeneration(generation)) {
                return;
              }
              if (frame.kind === 'ok') {
                this.artworkStore.setArtwork(generation, item.id, frame.value);
                break;
              }
              continue;
            }"""
    frame_instrumented = """            if (source === 'media-thumbnail') {
              const frameContext = captureDetailRowImageContext(this.workId, item.id);
              reportDetailRowImageStage(frameContext, 'source');
              reportDetailRowImageStage(frameContext, 'fetch-start');
              const frame = await fetchMediaThumbnail(item.mediaFileId);
              if (!this.artworkStore.isCurrentGeneration(generation)) {
                return;
              }
              if (frame.kind === 'ok') {
                reportDetailRowImageStage(frameContext, 'fetch-ok');
                reportDetailRowImageStage(frameContext, 'bridge-source-ready');
                reportDetailImagePayloadScope(frameContext, frame.value as Object as string);
                this.artworkStore.setArtwork(generation, item.id, frame.value);
                const frameStored = this.artworkStore.getArtwork(item.id) !== undefined;
                reportDetailRowImageStage(frameContext, frameStored ? 'artwork-store-present' : 'artwork-store-absent');
                if (frameStored) {
                  reportDetailRowImageStage(frameContext, 'artwork-store-updated');
                }
                reportDetailRowImageStage(frameContext, 'assigned');
                break;
              }
              reportDetailRowImageStage(frameContext, 'fetch-error');
              continue;
            }"""
    s = replace_episode_branch(s, frame, frame_instrumented, 'media-thumbnail')

    fallback = """            const seriesArtwork = await heroArtworkPromise;
            if (!this.artworkStore.isCurrentGeneration(generation)) {
              return;
            }
            if (seriesArtwork !== null) {
              this.artworkStore.setArtwork(generation, item.id, seriesArtwork);
              break;
            }"""
    fallback_instrumented = """            const seriesArtworkContext = captureDetailRowImageContext(this.workId, item.id);
            reportDetailRowImageStage(seriesArtworkContext, 'source');
            reportDetailRowImageStage(seriesArtworkContext, 'fetch-start');
            const seriesArtwork = await heroArtworkPromise;
            if (!this.artworkStore.isCurrentGeneration(generation)) {
              return;
            }
            if (seriesArtwork !== null) {
              reportDetailRowImageStage(seriesArtworkContext, 'fetch-ok');
              reportDetailRowImageStage(seriesArtworkContext, 'bridge-source-ready');
              reportDetailImagePayloadScope(seriesArtworkContext, seriesArtwork as Object as string);
              this.artworkStore.setArtwork(generation, item.id, seriesArtwork);
              const seriesArtworkStored = this.artworkStore.getArtwork(item.id) !== undefined;
              reportDetailRowImageStage(seriesArtworkContext,
                seriesArtworkStored ? 'artwork-store-present' : 'artwork-store-absent');
              if (seriesArtworkStored) {
                reportDetailRowImageStage(seriesArtworkContext, 'artwork-store-updated');
              }
              reportDetailRowImageStage(seriesArtworkContext, 'assigned');
              break;
            }
            reportDetailRowImageStage(seriesArtworkContext, 'fetch-error');"""
    return replace_episode_branch(s, fallback, fallback_instrumented, 'series-artwork fallback')

def player(s):
    # The Previewer draws a grey "Preview not available for this component." placeholder for a SURFACE XComponent; the app's own
    # background (PLAYER_BG, behind the video on a device) is what a player capture should show.
    old = """        XComponent({
          id: 'playarr-player-surface',
          type: XComponentType.SURFACE,
          controller: this.controller.surfaceController,
        })
          .width('100%')
          .height('100%')
"""
    assert s.count(old) == 1
    return s.replace(old, "        Column().width('100%').height('100%')\n", 1)

# The web refs are captured with the clock pinned to 2026-10-07T12:00Z (UTC, en-GB), so Calendar and the TV clock show Wednesday 7 October.
PINNED_NOW = "new Date(Date.UTC(2026, 9, 7, 12, 0, 0))"

def pinned_clock(s):
    return s.replace("localDayOf(new Date())", "localDayOf(" + PINNED_NOW + ")").replace("= new Date();", "= " + PINNED_NOW + ";")

def card_dbg(s):
    old = "        if (this.artwork !== undefined) {\n          Image(this.artwork)"
    assert old in s
    return s

if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('usage: patch_state.py <ets-root>')
    ROOT = sys.argv[1]
    edit('pages/Home.ets', home)
    edit('pages/Profiles.ets', profiles)
    edit('design/components/PosterCard.ets', card)
    edit('design/components/NavRail.ets', nav)
    edit('pages/Index.ets', index)
    edit('pages/Detail.ets', detail)
    edit('pages/Player.ets', player)
    edit('pages/Calendar.ets', pinned_clock)
    edit('design/components/Clock.ets', pinned_clock)
