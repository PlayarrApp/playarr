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
    s = s.replace("import { image } from '@kit.ImageKit';", "import { image } from '@kit.ImageKit';\nimport { reportCardFocus } from '../../util/PreviewState';", 1)
    old = "      this.setFocused(true);\n      this.onFocused();\n"
    assert old in s
    s = s.replace(old, old + "      reportCardFocus(this.title, this.subtitle);\n", 1)
    s = s.replace("    .focusable(true)\n    .onFocus(() => {\n      this.setFocused(true);\n      this.onFocused();", "    .focusable(true)\n    .focusOnTouch(true)\n    .id('pcard')\n    .onFocus(() => {\n      this.setFocused(true);\n      this.onFocused();", 1)
    s = s.replace("          Image(this.artwork)\n            .width('100%')", "          Image(this.artwork)\n            .onComplete(() => { previewReport('dbg=' + encodeURIComponent('imgok:' + this.title)); })\n            .onError((e) => { previewReport('dbg=' + encodeURIComponent('imgerr:' + this.title + ':' + JSON.stringify(e))); })\n            .width('100%')", 1)
    s = s.replace("import { reportCardFocus } from '../../util/PreviewState';", "import { reportCardFocus, previewReport } from '../../util/PreviewState';", 1)
    return s.replace("    .onClick(() => {\n      if (this.longPressFired) {", "    .onClick(() => {\n      reportCardFocus('click:' + this.title, '');\n      if (this.longPressFired) {", 1)

def nav(s):
    i = s.index("import ")
    s = s[:i] + "import { reportNavFocus } from '../../util/PreviewState';\n" + s[i:]
    old = "    .onFocus(() => {\n      this.setFocused(true);\n    })\n"
    assert old in s
    return s.replace(old, "    .focusOnTouch(true)\n    .onFocus(() => {\n      this.setFocused(true);\n      reportNavFocus(this.item.label);\n    })\n", 1)

def index(s):
    s = s.replace("import { http } from '@kit.NetworkKit';", "import { http } from '@kit.NetworkKit';\nimport { previewReport } from '../util/PreviewState';", 1)
    old = "  private previewPollOnce(): void {\n"
    assert old in s
    report = """  private previewReportState(): void {
    const names: string[] = this.navPathStack.getAllPathName();
    if (names.length === 0) {
      return;
    }
    const top: string = names[names.length - 1];
    let query: string = 'route=' + top;
    if (top === 'Library') {
      query = query + '&kind=' + (this.navPathStack.getParamByIndex(names.length - 1) as PreviewRouteParams).kind;
    } else if (top === 'Detail') {
      query = query + '&work=' + encodeURIComponent((this.navPathStack.getParamByIndex(names.length - 1) as PreviewDetailParams).workId);
    }
    previewReport(query);
  }

"""
    return s.replace(old, report + old + "    this.previewReportState();\n", 1)

def home(s):
    s = s.replace("import { image } from '@kit.ImageKit';", "import { image } from '@kit.ImageKit';\nimport { previewReport } from '../util/PreviewState';", 1)
    old = "    if (result.kind === 'ok') {\n      setItems(patchCardArtwork(getItems(), workId, result.value));"
    assert old in s
    return s.replace(old, "    previewReport('dbg=' + encodeURIComponent('cardart:' + result.kind + ':' + workId));\n" + old, 1)

def card_dbg(s):
    old = "        if (this.artwork !== undefined) {\n          Image(this.artwork)"
    assert old in s
    return s

edit('pages/Home.ets', home)
edit('design/components/PosterCard.ets', card)
edit('design/components/NavRail.ets', nav)
edit('pages/Index.ets', index)
