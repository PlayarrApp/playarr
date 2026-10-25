# Preview-only, run after patch_index.py: route-based navigation for the capture scripts, so they never click at
# (x, y) to move between pages (a layout change broke those clicks once). Usage: patch_route.py <Index.ets> <ctl-port>.
# The capture script posts a route name to the bridge (`hx.sh route <name>`: GET /setroute?name=...); Index polls
# GET /route every 700 ms and navigates with NavPathStack.replacePathByName. Names: home, calendar, search, settings,
# profiles, watchlist, requests, pairing, serversetup, library:<kind>. Never committed. No object literals typed as Record: the CLI-tools
# SDK (API 18) rejects them (arkts-no-untyped-obj-literals), the DevEco SDK on the Mac did not.
import sys
p, port = sys.argv[1], sys.argv[2]
s = open(p).read()
if 'previewPollOnce' in s:
    sys.exit(0)
methods = """
  private previewTimer: number = -1;

  private startPreviewRoutePoll(): void {
    this.previewTimer = setInterval((): void => {
      this.previewPollOnce();
    }, 1500);
  }

  // One request object, one call in flight, never destroyed mid-flight: the Previewer's libhttp crashed (access violation in
  // HttpExec::ReadResponse, freezing the whole app) when a timed-out poll was destroyed while the bridge was busy.
  private previewReq: http.HttpRequest = http.createHttp();
  private previewBusy: boolean = false;

  private previewPollOnce(): void {
    if (this.previewBusy) {
      return;
    }
    this.previewBusy = true;
    this.previewReq.request('http://127.0.0.1:%s/route', { method: http.RequestMethod.GET, connectTimeout: 5000, readTimeout: 5000 })
      .then((r: http.HttpResponse): void => {
        this.previewBusy = false;
        const name: string = String(r.result);
        if (name.length > 0) {
          this.previewGo(name);
        }
      })
      .catch((): void => {
        this.previewBusy = false;
      });
  }


  // Native text metrics for the layout export: every Text node of the inspector tree gets the lines ArkUI lays out for it
  // (found by asking the framework's own text measurer, never by assuming a font), so the exporter reports measured glyph runs.
  private previewMeasured(tree: string): string {
    const root: PvNode = JSON.parse(tree) as PvNode;
    this.previewMeasureNode(root);
    return JSON.stringify(root);
  }

  private previewMeasureNode(node: PvNode): void {
    const a: PvAttrs | undefined = node.$attrs;
    if (node.$type === 'Text' && a !== undefined) {
      try {
        node.$measured = this.previewMeasureText(node, a);
      } catch (err) {
        node.$measureError = JSON.stringify(err);
      }
    }
    const kids: PvNode[] | undefined = node.$children;
    if (kids !== undefined) {
      for (const kid of kids) {
        this.previewMeasureNode(kid);
      }
    }
  }

  private previewPad(a: PvAttrs, side: string): number {
    const raw: string | undefined = a.padding;
    if (raw === undefined) {
      return 0;
    }
    if (raw.indexOf('{') === 0) {
      const pad: PvPad = JSON.parse(raw) as PvPad;
      if (side === 'left') {
        return this.previewNumber(pad.left, 0);
      }
      if (side === 'right') {
        return this.previewNumber(pad.right, 0);
      }
      return 0;
    }
    return this.previewNumber(raw, 0);
  }

  private previewNumber(value: string | undefined, fallback: number): number {
    if (value === undefined) {
      return fallback;
    }
    const n: number = parseFloat(value);
    return isNaN(n) ? fallback : n;
  }

  private previewOneLine(st: PvStyle, text: string, constrain: boolean): SizeOptions {
    const mu: MeasureUtils = this.getUIContext().getMeasureUtils();
    if (st.family.length > 0) {
      return mu.measureTextSize({
        textContent: text, fontSize: st.size, fontFamily: st.family, letterSpacing: st.spacing, maxLines: 1,
        constraintWidth: constrain ? st.widthVp : undefined
      });
    }
    return mu.measureTextSize({
      textContent: text, fontSize: st.size, letterSpacing: st.spacing, maxLines: 1, constraintWidth: constrain ? st.widthVp : undefined
    });
  }

  private previewBlock(st: PvStyle, text: string): SizeOptions {
    const mu: MeasureUtils = this.getUIContext().getMeasureUtils();
    if (st.family.length > 0) {
      return mu.measureTextSize({
        textContent: text, fontSize: st.size, fontFamily: st.family, letterSpacing: st.spacing, constraintWidth: st.widthVp,
        lineHeight: st.lineHeight > 0 ? st.lineHeight : undefined
      });
    }
    return mu.measureTextSize({
      textContent: text, fontSize: st.size, letterSpacing: st.spacing, constraintWidth: st.widthVp, lineHeight: st.lineHeight > 0 ? st.lineHeight : undefined
    });
  }

  private previewMeasureText(node: PvNode, a: PvAttrs): PvLine[] {
    const ui: UIContext = this.getUIContext();
    let content: string = a.content !== undefined ? a.content : (a.text !== undefined ? a.text : '');
    const lines: PvLine[] = [];
    if (content.length === 0) {
      return lines;
    }
    const tc: string = a.textCase === undefined ? '' : a.textCase;
    if (tc.indexOf('Upper') >= 0) {
      content = content.toUpperCase();
    } else if (tc.indexOf('Lower') >= 0) {
      content = content.toLowerCase();
    }
    const rect: number[] = [];
    for (const part of String(node.$rect).split(',')) {
      rect.push(parseFloat(part));
    }
    const st: PvStyle = new PvStyle();
    st.widthVp = ui.px2vp(rect[2]) - this.previewPad(a, 'left') - this.previewPad(a, 'right');
    st.size = this.previewNumber(a.fontSize, 16);
    st.spacing = this.previewNumber(a.letterSpacing, 0);
    st.lineHeight = this.previewNumber(a.lineHeight, 0);
    st.family = a.fontFamily === undefined ? '' : a.fontFamily;
    const maxLines: number = this.previewNumber(a.maxLines, 0);
    const natural: SizeOptions = this.previewOneLine(st, 'Hg', false);
    const contentH: number = natural.height as number;
    const lineH: number = st.lineHeight > 0 ? ui.vp2px(st.lineHeight) : contentH;
    for (const paragraph of content.split('\\n')) {
      if (paragraph.length === 0) {
        continue;
      }
      const whole: SizeOptions = this.previewBlock(st, paragraph);
      if (maxLines === 1 || (whole.height as number) < lineH * 1.5) {
        // the text's own width (a constrained measure reports the box); an ellipsised line is as wide as the box
        const m: SizeOptions = this.previewOneLine(st, paragraph, false);
        const natural1: number = m.width as number;
        lines.push(this.previewLine(paragraph, Math.min(natural1, ui.vp2px(st.widthVp)), contentH, lineH));
        continue;
      }
      // wrapped: grow the line word by word, asking the measurer when the block no longer fits on one line
      let cur: string = '';
      for (const word of paragraph.split(' ')) {
        const trial: string = cur.length === 0 ? word : cur + ' ' + word;
        if (cur.length > 0 && (this.previewBlock(st, trial).height as number) > lineH * 1.5) {
          lines.push(this.previewLine(cur, this.previewOneLine(st, cur, false).width as number, contentH, lineH));
          cur = word;
        } else {
          cur = trial;
        }
      }
      if (cur.length > 0) {
        lines.push(this.previewLine(cur, this.previewOneLine(st, cur, false).width as number, contentH, lineH));
      }
    }
    return lines;
  }

  private previewLine(text: string, w: number, h: number, lineH: number): PvLine {
    const line: PvLine = new PvLine();
    line.text = text;
    line.w = w;
    line.h = h;
    line.lineH = lineH;
    return line;
  }

  private previewGo(name: string): void {
    if (name.indexOf('library:') === 0) {
      const params: PreviewRouteParams = new PreviewRouteParams(name.substring(8));
      setPreviewRouteContext('Library', params.kind, '');
      this.navPathStack.replacePathByName('Library', params);
      return;
    }
    if (name.indexOf('detail:') === 0) {
      const params: PreviewDetailParams = new PreviewDetailParams(name.substring(7));
      setPreviewRouteContext('Detail', '', params.workId);
      this.navPathStack.replacePathByName('Detail', params);
      return;
    }
    if (name.indexOf('dumplayout:') === 0) {
      // parity layout export: the component tree (box, text, font, colours) goes to the bridge, which keeps it for the capture driver
      try {
        const tree: string = this.getUIContext().getFilteredInspectorTree(['$rect', 'content', 'text', 'fontSize', 'fontColor', 'fontFamily', 'fontWeight',
          'backgroundColor', 'borderRadius', 'opacity', 'letterSpacing', 'textAlign', 'maxLines', 'lineHeight', 'id', 'visibility', 'textCase', 'accessibilityText']);
        this.previewReq.request('http://127.0.0.1:%s/layout-put?id=' + encodeURIComponent(name.substring(11)),
          { method: http.RequestMethod.POST, extraData: this.previewMeasured(tree), connectTimeout: 5000, readTimeout: 5000 }).catch((): void => {});
      } catch (err) {
        previewReport('dbg=' + encodeURIComponent('dumplayout-failed:' + JSON.stringify(err)));
      }
      return;
    }
    if (name.indexOf('focus:') === 0) {
      this.getUIContext().getFocusController().activate(true, false);
      let result: string = 'ok';
      if (name === 'focus:pcard') {
        result = previewFocusFirstCard(isTvMetrics());
        previewReport('dbg=' + encodeURIComponent('pcard-state:' + result));
        previewReport('focusack=' + encodeURIComponent(result));
        return;
      }
      try {
        this.getUIContext().getFocusController().requestFocus(name.substring(6));
      } catch (err) {
        result = JSON.stringify(err);
      }
      previewReport('dbg=' + encodeURIComponent(name.substring(6) + ':' + result));
      return;
    }
    if (name.indexOf('player:') === 0) {
      this.navPathStack.replacePathByName('Player', new PreviewPlayerParams(name.substring(7)));
      return;
    }
    const map: Map<string, string> = new Map<string, string>();
    for (const n of ['home:Home', 'calendar:Calendar', 'search:Search', 'settings:Settings', 'profiles:Profiles', 'watchlist:Watchlist',
      'requests:Requests', 'playlists:Playlists', 'downloads:Downloads', 'pairing:Pairing', 'serversetup:ServerSetup']) {
      map.set(n.split(':')[0], n.split(':')[1]);
    }
    const target: string | undefined = map.get(name);
    if (target !== undefined) {
      setPreviewRouteContext(target, '', '');
      this.navPathStack.replacePathByName(target, undefined);
    }
  }
""" % (port, port)
s = s.replace("\n@Entry", "\nclass PvLine {\n  text: string = '';\n  w: number = 0;\n  h: number = 0;\n  lineH: number = 0;\n}\n\nclass PvStyle {\n  widthVp: number = 0;\n  size: number = 16;\n  spacing: number = 0;\n  lineHeight: number = 0;\n  family: string = '';\n}\n\ninterface PvPad {\n  left?: string;\n  right?: string;\n}\n\ninterface PvAttrs {\n  padding?: string;\n  content?: string;\n  text?: string;\n  fontSize?: string;\n  fontFamily?: string;\n  letterSpacing?: string;\n  lineHeight?: string;\n  maxLines?: string;\n  textCase?: string;\n}\n\ninterface PvNode {\n  $type: string;\n  $rect: string;\n  $attrs?: PvAttrs;\n  $children?: PvNode[];\n  $measured?: PvLine[];\n  $measureError?: string;\n}\n\nclass PreviewRouteParams {\n  kind: string;\n  constructor(kind: string) { this.kind = kind; }\n}\n\nclass PreviewDetailParams {\n  workId: string;\n  constructor(workId: string) { this.workId = workId; }\n}\n\nclass PreviewPlayerParams {\n  mediaFileId: string;\n  workId: string = '';\n  constructor(mediaFileId: string) { this.mediaFileId = mediaFileId; }\n}\n\n@Entry", 1)
s = s.replace("\n  @Builder\n  previewRoutes(", methods + "\n  @Builder\n  previewRoutes(", 1)
s = s.replace("import { ROUTES } from '../navigation/Routes';", "import { http } from '@kit.NetworkKit';\nimport { MeasureUtils } from '@kit.ArkUI';\nimport { isTvMetrics } from '../design/Metrics';\nimport { ROUTES } from '../navigation/Routes';", 1)
s = s.replace("  aboutToAppear(): void {\n", "  aboutToAppear(): void {\n    this.startPreviewRoutePoll();\n", 1)
assert 'this.startPreviewRoutePoll();' in s and 'previewPollOnce' in s
open(p, 'w').write(s)
