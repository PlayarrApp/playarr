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
    s = s.replace("  onLongPress: () => void = () => {};", "  onLongPress: () => void = () => {};\n  onPreviewRowImageComplete: () => void = () => {};", 1)
    old = "      this.setFocused(true);\n      this.onFocused();\n"
    assert old in s
    s = s.replace(old, old + "      reportCardFocus(this.title, this.subtitle);\n", 1)
    s = s.replace("    .focusable(true)\n    .onFocus(() => {\n      this.setFocused(true);\n      this.onFocused();", "    .focusable(true)\n    .focusOnTouch(true)\n    .id('pcard')\n    .onFocus(() => {\n      this.setFocused(true);\n      this.onFocused();", 1)
    s = s.replace("          Image(this.artwork)\n            .width('100%')", "          Image(this.artwork)\n            .onComplete(() => { previewReport('dbg=' + encodeURIComponent('poster-image-complete')); this.onPreviewRowImageComplete(); })\n            .onError(() => { previewReport('dbg=' + encodeURIComponent('poster-image-error')); })\n            .width('100%')", 1)
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
    s = s.replace("import { PosterCard } from '../design/components/PosterCard';", "import { PosterCard } from '../design/components/PosterCard';\nimport { captureDetailRowImageContext, reportDetailRowImageComplete } from '../util/PreviewState';", 1)
    marker = "// -- UI-only constants"
    helper = """function createDetailRowImageCompletion(parentWorkId: string, rowId: string): () => void {
  const context = captureDetailRowImageContext(parentWorkId, rowId);
  return (): void => { reportDetailRowImageComplete(context); };
}

"""
    assert marker in s
    s = s.replace(marker, helper + marker, 1)
    old = "  private rowItem(item: MediaRailItem, index: number, activeRailFactor: number): void {\n    if (isTvMetrics()) {"
    assert old in s
    start = s.index("  private rowItem(item: MediaRailItem")
    end = s.index("  /** Similar-title row content", start)
    row = s[start:end]
    row = row.replace("        variant: 'titleEpisode',\n", "        variant: 'titleEpisode',\n        onPreviewRowImageComplete: createDetailRowImageCompletion(this.workId, (item as DetailRow).id),\n")
    return s[:start] + row + s[end:]

def card_dbg(s):
    old = "        if (this.artwork !== undefined) {\n          Image(this.artwork)"
    assert old in s
    return s

edit('pages/Home.ets', home)
edit('design/components/PosterCard.ets', card)
edit('design/components/NavRail.ets', nav)
edit('pages/Index.ets', index)
edit('pages/Detail.ets', detail)
