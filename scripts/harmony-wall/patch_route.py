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


  // Glyph runs for the layout export: every Text of the inspector tree carries the lines its own layout manager reports for the live
  // component (patch_text.py gives each Text a controller and an id; util/PreviewText.ets reads them). Nothing is estimated.
  private previewMeasured(tree: string): string {
    const root: PvNode = JSON.parse(tree) as PvNode;
    this.previewMeasureNode(root);
    return JSON.stringify(root);
  }

  private previewMeasureNode(node: PvNode): void {
    const a: PvAttrs | undefined = node.$attrs;
    if (node.$type === 'Text' && a !== undefined) {
      try {
        node.$runs = pvTextLines(a.accessibilityDescription === undefined ? '' : a.accessibilityDescription);
      } catch (err) {
        node.$runsError = String(err);
      }
    }
    const kids: PvNode[] | undefined = node.$children;
    if (kids !== undefined) {
      for (const kid of kids) {
        this.previewMeasureNode(kid);
      }
    }
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
          'backgroundColor', 'borderRadius', 'opacity', 'letterSpacing', 'textAlign', 'maxLines', 'lineHeight', 'id', 'visibility', 'textCase', 'accessibilityText', 'accessibilityDescription', 'accessibilityRole', 'accessibilityGroup', 'accessibilityLevel', 'blendMode', 'focusable', 'clickable']);
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
s = s.replace("\n@Entry", "\ninterface PvAttrs {\n  accessibilityDescription?: string;\n}\n\ninterface PvNode {\n  $type: string;\n  $rect: string;\n  $attrs?: PvAttrs;\n  $children?: PvNode[];\n  $runs?: PvLine[];\n  $runsError?: string;\n}\n\nclass PreviewRouteParams {\n  kind: string;\n  constructor(kind: string) { this.kind = kind; }\n}\n\nclass PreviewDetailParams {\n  workId: string;\n  constructor(workId: string) { this.workId = workId; }\n}\n\nclass PreviewPlayerParams {\n  mediaFileId: string;\n  workId: string = '';\n  constructor(mediaFileId: string) { this.mediaFileId = mediaFileId; }\n}\n\n@Entry", 1)
s = s.replace("\n  @Builder\n  previewRoutes(", methods + "\n  @Builder\n  previewRoutes(", 1)
s = s.replace("import { ROUTES } from '../navigation/Routes';", "import { http } from '@kit.NetworkKit';\nimport { PvLine, pvTextLines } from '../util/PreviewText';\nimport { isTvMetrics } from '../design/Metrics';\nimport { ROUTES } from '../navigation/Routes';", 1)
s = s.replace("  aboutToAppear(): void {\n", "  aboutToAppear(): void {\n    this.startPreviewRoutePoll();\n", 1)
assert 'this.startPreviewRoutePoll();' in s and 'previewPollOnce' in s
open(p, 'w').write(s)
