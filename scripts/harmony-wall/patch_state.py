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
    s = s.replace("          Image(this.artwork)\n            .width('100%')", "          Image(this.artwork)\n            .onComplete(() => { if (this.variant === 'titleEpisode') { previewReport('dbg=' + encodeURIComponent('episode-art:card-image:ok')); } })\n            .onError(() => { if (this.variant === 'titleEpisode') { previewReport('dbg=' + encodeURIComponent('episode-art:card-image:error')); } })\n            .width('100%')", 1)
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

def detail(s):
    s = s.replace("import { getWorkDetail, getSimilarWorks, getWorkCredits, getResumePlan } from '../data/CatalogRepository';",
                  "import { getWorkDetail, getSimilarWorks, getWorkCredits, getResumePlan } from '../data/CatalogRepository';\nimport { previewReport } from '../util/PreviewState';", 1)
    old = "@Component\nstruct Detail {"
    assert old in s
    s = s.replace(old, "let PREVIEW_EPISODE_ART_DIAG_COUNT: number = 0;\n\n" + old, 1)
    old = """      for (const item of rail.items) {
        if (item.hasEpisodeStill) {
          const still = await fetchEpisodeArtwork(artistWorkId, item.id, 'thumb');
          if (still.kind === 'ok') {
            this.rails = applyRowArtworkAcrossRails(this.rails, item.id, still.value);
            continue;
          }
        }
        if (item.mediaFileId === null) {
          continue;
        }
        const thumb = await fetchMediaThumbnail(item.mediaFileId, 0);
        if (thumb.kind === 'ok') {"""
    new = """      for (const item of rail.items) {
        const diagnoseEpisodeArt: boolean = rail.id.indexOf('season-') === 0 && PREVIEW_EPISODE_ART_DIAG_COUNT < 4;
        if (diagnoseEpisodeArt) {
          PREVIEW_EPISODE_ART_DIAG_COUNT += 1;
          previewReport('dbg=' + encodeURIComponent('episode-art:row:thumb=' + (item.hasEpisodeStill ? 'yes' : 'no') + ':file=' + (item.mediaFileId !== null ? 'yes' : 'no')));
        }
        if (item.hasEpisodeStill) {
          const still = await fetchEpisodeArtwork(artistWorkId, item.id, 'thumb');
          if (diagnoseEpisodeArt) {
            let stillCategory: string = still.kind;
            if (still.kind === 'http_failure') {
              stillCategory = 'http-' + String(still.status);
            } else if (still.kind === 'network_failure') {
              stillCategory = still.message.indexOf('Failed to decode artwork bytes:') === 0 ? 'decode-failure' : 'network-' + still.reason;
            }
            previewReport('dbg=' + encodeURIComponent('episode-art:still:' + stillCategory));
          }
          if (still.kind === 'ok') {
            this.rails = applyRowArtworkAcrossRails(this.rails, item.id, still.value);
            if (diagnoseEpisodeArt) {
              previewReport('dbg=' + encodeURIComponent('episode-art:assigned:still'));
            }
            continue;
          }
        }
        if (item.mediaFileId === null) {
          continue;
        }
        const thumb = await fetchMediaThumbnail(item.mediaFileId, 0);
        if (diagnoseEpisodeArt) {
          let thumbCategory: string = thumb.kind;
          if (thumb.kind === 'http_failure') {
            thumbCategory = 'http-' + String(thumb.status);
          } else if (thumb.kind === 'network_failure') {
            thumbCategory = thumb.message.indexOf('Failed to decode artwork bytes:') === 0 ? 'decode-failure' : 'network-' + thumb.reason;
          }
          previewReport('dbg=' + encodeURIComponent('episode-art:fallback:' + thumbCategory));
        }
        if (thumb.kind === 'ok') {
          this.rails = applyRowArtworkAcrossRails(this.rails, item.id, thumb.value);
          if (diagnoseEpisodeArt) {
            previewReport('dbg=' + encodeURIComponent('episode-art:assigned:fallback'));
          }
        }"""
    assert old in s
    return s.replace(old, new, 1)

def card_dbg(s):
    old = "        if (this.artwork !== undefined) {\n          Image(this.artwork)"
    assert old in s
    return s

edit('pages/Home.ets', home)
edit('pages/Detail.ets', detail)
edit('design/components/PosterCard.ets', card)
edit('design/components/NavRail.ets', nav)
edit('pages/Index.ets', index)
