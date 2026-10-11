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
    }, 700);
  }

  private previewPollOnce(): void {
    const req = http.createHttp();
    req.request('http://127.0.0.1:%s/route', { method: http.RequestMethod.GET, connectTimeout: 800, readTimeout: 800 })
      .then((r: http.HttpResponse): void => {
        const name: string = String(r.result);
        if (name.length > 0) {
          this.previewGo(name);
        }
        req.destroy();
      })
      .catch((): void => {
        req.destroy();
      });
  }

  private previewGo(name: string): void {
    if (name.indexOf('library:') === 0) {
      const params: PreviewRouteParams = new PreviewRouteParams(name.substring(8));
      this.navPathStack.replacePathByName('Library', params);
      return;
    }
    const map: Map<string, string> = new Map<string, string>();
    for (const n of ['home:Home', 'calendar:Calendar', 'search:Search', 'settings:Settings', 'profiles:Profiles', 'watchlist:Watchlist',
      'requests:Requests', 'playlists:Playlists', 'downloads:Downloads', 'pairing:Pairing', 'serversetup:ServerSetup']) {
      map.set(n.split(':')[0], n.split(':')[1]);
    }
    const target: string | undefined = map.get(name);
    if (target !== undefined) {
      this.navPathStack.replacePathByName(target, undefined);
    }
  }
""" % port
s = s.replace("\n@Entry", "\nclass PreviewRouteParams {\n  kind: string;\n  constructor(kind: string) { this.kind = kind; }\n}\n\n@Entry", 1)
s = s.replace("\n  @Builder\n  previewRoutes(", methods + "\n  @Builder\n  previewRoutes(", 1)
s = s.replace("import { ROUTES } from '../navigation/Routes';", "import { http } from '@kit.NetworkKit';\nimport { ROUTES } from '../navigation/Routes';", 1)
s = s.replace("  aboutToAppear(): void {\n", "  aboutToAppear(): void {\n    this.startPreviewRoutePoll();\n", 1)
assert 'this.startPreviewRoutePoll();' in s and 'previewPollOnce' in s
open(p, 'w').write(s)
