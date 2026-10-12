# Preview-only, run after patch_route.py (never committed): the parity state for the suite driver. Cards and nav tiles report their focus,
# and the route poll also reports the top route name (and Library kind). Usage: patch_state.py <ets-root> (clients/harmony/entry/src/main/ets copy).
import re, sys
root = sys.argv[1]

def edit(rel, fn):
    p = root + '/' + rel
    s = open(p).read()
    if 'PreviewState' in s:
        return
    s = fn(s)
    open(p, 'w').write(s)

def card(s):
    s = s.replace("import { image } from '@kit.ImageKit';", "import { image } from '@kit.ImageKit';\nimport { reportCardFocus, previewReport } from '../../util/PreviewState';", 1)
    s = s.replace("  onLongPress: () => void = () => {};", "  onLongPress: () => void = () => {};\n  @Prop onPreviewRowImageSource: () => void = () => {};\n  @Prop onPreviewRowImageArea: (positive: boolean) => void = (_positive: boolean) => {};\n  @Prop onPreviewRowImageComplete: () => void = () => {};\n  @Prop onPreviewRowImageError: () => void = () => {};\n  @Prop onPreviewLayout: (stage: string, value: number, width: number, height: number) => void = (_stage: string, _value: number, _width: number, _height: number) => {};", 1)
    old = "      this.setFocused(true);\n      this.onFocused();\n"
    assert old in s
    s = s.replace(old, old + "      reportCardFocus(this.title, this.subtitle);\n", 1)
    s = s.replace("    .focusable(true)\n    .onFocus(() => {\n      this.setFocused(true);\n      this.onFocused();", "    .focusable(true)\n    .focusOnTouch(true)\n    .id('pcard')\n    .onFocus(() => {\n      this.setFocused(true);\n      this.onFocused();", 1)
    s = s.replace("          Image(this.artwork)\n            .width('100%')", "          Image(this.artwork)\n            .onAppear(() => { this.onPreviewRowImageSource(); })\n            .onAreaChange((_old: Area, area: Area) => { this.onPreviewRowImageArea(Number(area.width) > 0 && Number(area.height) > 0); })\n            .onComplete(() => { previewReport('dbg=' + encodeURIComponent('poster-image-complete')); this.onPreviewRowImageComplete(); })\n            .onError(() => { previewReport('dbg=' + encodeURIComponent('poster-image-error')); this.onPreviewRowImageError(); })\n            .width('100%')", 1)
    s = s.replace("      .width(this.cardWidth)\n      .height(this.cardHeight)\n      .clip(true)", "      .width(this.cardWidth)\n      .height(this.cardHeight)\n      .onAreaChange((_old: Area, area: Area) => { this.onPreviewLayout('poster-card-art-area', 0, Number(area.width), Number(area.height)); })\n      .clip(true)", 1)
    s = s.replace("    .width(this.cardWidth)\n    .alignItems(HorizontalAlign.Start)", "    .width(this.cardWidth)\n    .onAreaChange((_old: Area, area: Area) => { this.onPreviewLayout('poster-card-root-area', 0, Number(area.width), Number(area.height)); })\n    .alignItems(HorizontalAlign.Start)", 1)
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
    s = s.replace("import { PosterCard } from '../design/components/PosterCard';", "import { PosterCard } from '../design/components/PosterCard';\nimport { captureDetailLayoutContext, reportDetailLayoutStage, captureDetailRowImageContext, reportDetailRowImageStage } from '../util/PreviewState';", 1)
    marker = "// -- UI-only constants"
    helper = """function createDetailRowImageStageCallback(parentWorkId: string, rowId: string, stage: string): () => void {
  const context = captureDetailRowImageContext(parentWorkId, rowId);
  return (): void => { reportDetailRowImageStage(context, stage); };
}

function createDetailRowImageAreaCallback(parentWorkId: string, rowId: string): (positive: boolean) => void {
  const context = captureDetailRowImageContext(parentWorkId, rowId);
  return (positive: boolean): void => {
    reportDetailRowImageStage(context, positive ? 'image-area-positive' : 'image-area-zero');
  };
}

function createDetailLayoutCallback(parentWorkId: string): (stage: string, value: number, width: number, height: number) => void {
  const context = captureDetailLayoutContext(parentWorkId);
  return (stage: string, value: number, width: number, height: number): void => {
    reportDetailLayoutStage(context, stage, value, width, height);
  };
}

"""
    assert marker in s
    s = s.replace(marker, helper + marker, 1)
    old = "  private rowItem(item: MediaRailItem, index: number, activeRailFactor: number): void {\n    if (isTvMetrics()) {"
    assert old in s
    start = s.index("  private rowItem(item: MediaRailItem")
    end = s.index("  /** Similar-title row content", start)
    row = s[start:end]
    row = row.replace("        variant: 'titleEpisode',\n", "        variant: 'titleEpisode',\n        onPreviewRowImageSource: createDetailRowImageStageCallback(this.workId, (item as DetailRow).id, 'image-source'),\n        onPreviewRowImageArea: createDetailRowImageAreaCallback(this.workId, (item as DetailRow).id),\n        onPreviewRowImageComplete: createDetailRowImageStageCallback(this.workId, (item as DetailRow).id, 'on-complete'),\n        onPreviewRowImageError: createDetailRowImageStageCallback(this.workId, (item as DetailRow).id, 'on-error'),\n        onPreviewLayout: createDetailLayoutCallback(this.workId),\n")
    s = s[:start] + row + s[end:]
    old = """        const thumb = await fetchMediaThumbnail(item.mediaFileId, 0);
        if (thumb.kind === 'ok') {
          this.rails = applyRowArtworkAcrossRails(this.rails, item.id, thumb.value);
        }"""
    assert old in s
    new = """        const previewContext = captureDetailRowImageContext(this.workId, item.id);
        reportDetailRowImageStage(previewContext, 'source');
        reportDetailRowImageStage(previewContext, 'fetch-start');
        const thumb = await fetchMediaThumbnail(item.mediaFileId, 0);
        if (thumb.kind === 'ok') {
          reportDetailRowImageStage(previewContext, 'fetch-ok');
          reportDetailRowImageStage(previewContext, 'bridge-source-ready');
          this.rails = applyRowArtworkAcrossRails(this.rails, item.id, thumb.value);
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
    tv = tv.replace(old_items, "            items: rail.items,\n            onPreviewLayout: createDetailLayoutCallback(this.workId),\n            itemBuilder:", 1)
    s = s[:tv_start] + tv + s[tv_end:]
    old_rails = "    const rails = buildRailsFromChildren(detail.children);\n    this.rails = rails;"
    assert old_rails in s
    s = s.replace(old_rails, old_rails + "\n    const layoutContext = captureDetailLayoutContext(this.workId);\n    reportDetailLayoutStage(layoutContext, 'detail-rails-count', rails.length, -1, -1);", 1)
    return s

def card_dbg(s):
    old = "        if (this.artwork !== undefined) {\n          Image(this.artwork)"
    assert old in s
    return s

edit('pages/Home.ets', home)
edit('design/components/PosterCard.ets', card)
edit('design/components/NavRail.ets', nav)
edit('pages/Index.ets', index)
edit('pages/Detail.ets', detail)
