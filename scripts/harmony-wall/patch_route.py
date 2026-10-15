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
    if (name.indexOf('focus:') === 0) {
      this.getUIContext().getFocusController().activate(true, false);
      let result: string = 'ok';
      if (name === 'focus:pcard') {
        result = previewFocusFirstCard();
        previewReport('dbg=' + encodeURIComponent('pcard-state:' + result));
        previewReport('title=' + encodeURIComponent('state-focused') + '&sub=');
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
""" % port
s = s.replace("\n@Entry", "\nclass PreviewRouteParams {\n  kind: string;\n  constructor(kind: string) { this.kind = kind; }\n}\n\nclass PreviewDetailParams {\n  workId: string;\n  constructor(workId: string) { this.workId = workId; }\n}\n\nclass PreviewPlayerParams {\n  mediaFileId: string;\n  workId: string = '';\n  constructor(mediaFileId: string) { this.mediaFileId = mediaFileId; }\n}\n\n@Entry", 1)
s = s.replace("\n  @Builder\n  previewRoutes(", methods + "\n  @Builder\n  previewRoutes(", 1)
s = s.replace("import { ROUTES } from '../navigation/Routes';", "import { http } from '@kit.NetworkKit';\nimport { ROUTES } from '../navigation/Routes';", 1)
s = s.replace("  aboutToAppear(): void {\n", "  aboutToAppear(): void {\n    this.startPreviewRoutePoll();\n", 1)
assert 'this.startPreviewRoutePoll();' in s and 'previewPollOnce' in s
open(p, 'w').write(s)
