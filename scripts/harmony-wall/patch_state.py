# Preview-only, run after patch_route.py (never committed): the parity state for the suite driver. Cards and nav tiles report their focus,
# and the route poll also reports the top route name (and Library kind). Usage: patch_state.py <ets-root> (clients/harmony/entry/src/main/ets copy).
import re, sys

def edit(rel, fn):
    p = ROOT + '/' + rel
    s = open(p).read()
    if 'PreviewState' in s:
        return
    s = fn(s)
    open(p, 'w').write(s)

def card(s):
    s = s.replace("import { image } from '@kit.ImageKit';", "import { image } from '@kit.ImageKit';\nimport { reportCardFocus, previewReport, reportDetailLayoutStageForScope, reportDetailRowImageStageForScope } from '../../util/PreviewState';", 1)
    s = s.replace("  @Prop artwork: image.PixelMap | undefined = undefined;", "  @Prop previewRoute: string = '';\n  @Prop previewWorkId: string = '';\n  @Prop previewRowId: string = '';\n  @Prop previewGeneration: number = 0;\n  @Prop @Watch('previewArtworkUpdated') artwork: image.PixelMap | undefined = undefined;", 1)
    s = s.replace("          Image(this.artwork)\n            .width('100%')", "          Image(this.artwork)\n            .onAppear(() => { reportDetailRowImageStageForScope(this.previewRoute, this.previewWorkId, this.previewRowId, this.previewGeneration, 'poster-render-artwork-present'); reportDetailRowImageStageForScope(this.previewRoute, this.previewWorkId, this.previewRowId, this.previewGeneration, 'image-source'); })\n            .onAreaChange((_old: Area, area: Area) => { reportDetailRowImageStageForScope(this.previewRoute, this.previewWorkId, this.previewRowId, this.previewGeneration, Number(area.width) > 0 && Number(area.height) > 0 ? 'image-area-positive' : 'image-area-zero'); })\n            .onComplete(() => { previewReport('dbg=' + encodeURIComponent('poster-image-complete')); reportDetailRowImageStageForScope(this.previewRoute, this.previewWorkId, this.previewRowId, this.previewGeneration, 'on-complete'); })\n            .onError(() => { previewReport('dbg=' + encodeURIComponent('poster-image-error')); reportDetailRowImageStageForScope(this.previewRoute, this.previewWorkId, this.previewRowId, this.previewGeneration, 'on-error'); })\n            .width('100%')", 1)
    old = "      this.setFocused(true);\n      this.onFocused();\n"
    assert old in s
    s = s.replace(old, old + "      reportCardFocus(this.title, this.subtitle);\n", 1)
    s = s.replace("    .focusable(true)\n    .onFocus(() => {\n      this.setFocused(true);\n      this.onFocused();", "    .focusable(true)\n    .focusOnTouch(true)\n    .id('pcard')\n    .onFocus(() => {\n      this.setFocused(true);\n      this.onFocused();", 1)
    s = s.replace("          Skeleton({ blockWidth: this.cardWidth, blockHeight: this.cardHeight, radius: this.resolvedArtworkRadius() })", "          Skeleton({ blockWidth: this.cardWidth, blockHeight: this.cardHeight, radius: this.resolvedArtworkRadius() })\n            .onAppear(() => { reportDetailRowImageStageForScope(this.previewRoute, this.previewWorkId, this.previewRowId, this.previewGeneration, 'poster-render-artwork-undefined'); })", 1)
    s = s.replace("      .width(this.cardWidth)\n      .height(this.cardHeight)\n      .clip(true)", "      .width(this.cardWidth)\n      .height(this.cardHeight)\n      .onAreaChange((_old: Area, area: Area) => { reportDetailLayoutStageForScope(this.previewRoute, this.previewWorkId, this.previewGeneration, 'poster-card-art-area', 0, Number(area.width), Number(area.height)); })\n      .clip(true)", 1)
    s = s.replace("    .width(this.cardWidth)\n    .alignItems(HorizontalAlign.Start)", "    .width(this.cardWidth)\n    .onAreaChange((_old: Area, area: Area) => { reportDetailLayoutStageForScope(this.previewRoute, this.previewWorkId, this.previewGeneration, 'poster-card-root-area', 0, Number(area.width), Number(area.height)); })\n    .alignItems(HorizontalAlign.Start)", 1)
    build = "  build() {\n\n    Column({ space: Spacing.xs }) {"
    assert build in s
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
    s = s.replace("import { http } from '@kit.NetworkKit';", "import { http } from '@kit.NetworkKit';\nimport { previewReport, reportPreviewRoute, setPreviewRouteContext } from '../util/PreviewState';", 1)
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

def detail(s):
    s = s.replace("import { PosterCard } from '../design/components/PosterCard';", "import { PosterCard } from '../design/components/PosterCard';\nimport { currentPreviewRouteGeneration, reportDetailLayoutStageForScope, captureDetailRowImageContext, reportDetailRowImageStage, reportDetailImagePayloadScope } from '../util/PreviewState';", 1)
    artwork_store = "  @ObjectLink artworkStore: DetailArtworkStore;\n"
    assert artwork_store in s
    s = s.replace(artwork_store, artwork_store + "  @Prop previewRoute: string = '';\n  @Prop previewWorkId: string = '';\n  @Prop previewRowId: string = '';\n  @Prop previewGeneration: number = 0;\n", 1)
    card_variant = "      variant: this.variant,\n"
    assert card_variant in s
    s = s.replace(card_variant, card_variant + "      previewRoute: this.previewRoute,\n      previewWorkId: this.previewWorkId,\n      previewRowId: this.previewRowId,\n      previewGeneration: this.previewGeneration,\n", 1)
    artwork_store_arg = re.compile(r"(?m)^(?P<indent>\s*)artworkStore: this\.artworkStore,\n(?P=indent)rowId: \(item as DetailRow\)\.id,\n")
    matches = artwork_store_arg.findall(s)
    assert len(matches) == 5
    def add_preview_context(match):
        indent = match.group('indent')
        return match.group(0) + indent + "previewRoute: 'Detail',\n" + indent + "previewWorkId: this.workId,\n" + indent + "previewRowId: (item as DetailRow).id,\n" + indent + "previewGeneration: currentPreviewRouteGeneration(),\n"
    s = artwork_store_arg.sub(add_preview_context, s)
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
    tv_start = s.index("  private tvRightColumn(): void {")
    tv_end = s.index("  @Builder\n  private chapterItem", tv_start)
    tv = s[tv_start:tv_end]
    old_items = "            items: rail.items,\n            itemBuilder:"
    assert old_items in tv
    tv = tv.replace(old_items, "            items: rail.items,\n            previewRoute: 'Detail',\n            previewWorkId: this.workId,\n            previewGeneration: currentPreviewRouteGeneration(),\n            itemBuilder:", 1)
    s = s[:tv_start] + tv + s[tv_end:]
    old_rails = "    const rails = buildRailsFromChildren(detail.children);\n    this.rails = rails;"
    assert old_rails in s
    s = s.replace(old_rails, old_rails + "\n    reportDetailLayoutStageForScope('Detail', this.workId, currentPreviewRouteGeneration(), 'detail-rails-count', rails.length, -1, -1);", 1)
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

def card_dbg(s):
    old = "        if (this.artwork !== undefined) {\n          Image(this.artwork)"
    assert old in s
    return s

if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('usage: patch_state.py <ets-root>')
    ROOT = sys.argv[1]
    edit('pages/Home.ets', home)
    edit('design/components/PosterCard.ets', card)
    edit('design/components/NavRail.ets', nav)
    edit('pages/Index.ets', index)
    edit('pages/Detail.ets', detail)
