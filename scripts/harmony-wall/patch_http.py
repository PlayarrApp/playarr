# Preview-only (never committed). Usage: patch_http.py <HttpTransport.ets> <other .ets files with destroy() calls>...
# 1. The Previewer's libhttp crashes (access violation in HttpExec::ReadResponse, the whole app freezes) some of the time when a request
#    object is destroyed while its read thread is still winding down. Leaking the single-use request objects for the length of a capture
#    run is harmless.
# 2. Home fires one artwork fetch per card (about a hundred at once); through the Previewer's network stack the burst times out or fails
#    and the cards stay blank. HttpTransport's sendHttpRequest is gated to a few requests in flight.
import sys
import re

def patch_source(source):
    marker = "import { http } from '@kit.NetworkKit';"
    assert source.count(marker) == 1, 'NetworkKit import not found exactly once'
    create_http = re.compile(r"(?m)^(?P<indent>[ \t]*)const (?P<name>\w+) = http\.createHttp\(\);")
    matches = list(create_http.finditer(source))
    assert matches, 'expected at least one Previewer HTTP request handle'
    assert source.count('http.createHttp();') == len(matches), 'unrecognised Previewer HTTP request creation pattern'
    retain_marker = 'const PREVIEW_HTTP_REQUESTS: Array<http.HttpRequest> = [];'
    if retain_marker not in source:
        source = source.replace(marker, marker + "\n\n// Keep Previewer request handles alive until its process exits.\n" + retain_marker, 1)
        source = create_http.sub(lambda match: match.group(0) + "\n" + match.group('indent') + "PREVIEW_HTTP_REQUESTS.push(" + match.group('name') + ");", source)
    else:
        retained = re.findall(r"PREVIEW_HTTP_REQUESTS\.push\((\w+)\);", source)
        handles = re.findall(r"(?m)^\s*const (\w+) = http\.createHttp\(\);", source)
        assert retained == handles, 'Previewer HTTP handle retention is incomplete or duplicated'
    return source.replace("client.destroy();", "/* request left alive (libhttp crash) */").replace("req.destroy();", "/* request left alive (libhttp crash) */")

GATE = """
// Artwork and thumbnails (many, large) go through a gate of a few in flight; every other API call bypasses it, so a page's data
// is never queued behind a hundred posters. The bridge is told when the app goes idle (nothing pending), and the capture waits for it.
let PREVIEW_HTTP_ACTIVE: number = 0;
let PREVIEW_HTTP_API_PENDING: number = 0;
let PREVIEW_HTTP_LAST_REPORT: string = '';
const PREVIEW_HTTP_WAITERS: Array<() => void> = [];
const PREVIEW_HTTP_LIMIT: number = 4;

function previewHttpIsArt(url: string): boolean {
  return url.indexOf('/api/v1/artwork/') >= 0 || url.indexOf('/thumbnail') >= 0;
}

function previewHttpReport(): void {
  const idle: string = PREVIEW_HTTP_ACTIVE + PREVIEW_HTTP_WAITERS.length + PREVIEW_HTTP_API_PENDING === 0 ? 'idle' : 'busy';
  if (idle !== PREVIEW_HTTP_LAST_REPORT) {
    PREVIEW_HTTP_LAST_REPORT = idle;
    previewReport('net=' + idle);
  }
}

// Diagnostics: one line per request (status and path only, no host) to the bridge log.
function previewHttpPath(url: string): string {
  const start: number = url.indexOf('/api/');
  return start >= 0 ? url.substring(start, Math.min(url.length, start + 90)) : 'other';
}

export async function sendHttpRequest(url: string, options: HttpRequestOptions): Promise<HttpTransportResponse> {
  const response: HttpTransportResponse = await sendHttpRequestGated(url, options);
  previewReport('dbg=http:' + response.status.toString() + ':' + (previewHttpIsArt(url) ? 'art' : 'api') + ':' + previewHttpPath(url));
  return response;
}

async function sendHttpRequestGated(url: string, options: HttpRequestOptions): Promise<HttpTransportResponse> {
  if (!previewHttpIsArt(url)) {
    PREVIEW_HTTP_API_PENDING += 1;
    previewHttpReport();
    try {
      return await sendHttpRequestUngated(url, options);
    } finally {
      PREVIEW_HTTP_API_PENDING -= 1;
      previewHttpReport();
    }
  }
  if (PREVIEW_HTTP_ACTIVE >= PREVIEW_HTTP_LIMIT) {
    await new Promise<void>((resolve: () => void): void => {
      PREVIEW_HTTP_WAITERS.push(resolve);
      previewHttpReport();
    });
  }
  PREVIEW_HTTP_ACTIVE += 1;
  previewHttpReport();
  try {
    return await sendHttpRequestUngated(url, options);
  } finally {
    PREVIEW_HTTP_ACTIVE -= 1;
    const next: (() => void) | undefined = PREVIEW_HTTP_WAITERS.shift();
    if (next !== undefined) {
      next();
    }
    previewHttpReport();
  }
}
"""
def patch_files(paths):
  for i, p in enumerate(paths):
    s = open(p).read()
    s = patch_source(s)
    if i == 0 and "PREVIEW_HTTP_ACTIVE" not in s:
        old = "export async function sendHttpRequest(url: string, options: HttpRequestOptions): Promise<HttpTransportResponse> {"
        assert old in s
        s = "import { previewReport } from '../util/PreviewState';\n" + s
        s = s.replace(old, "async function sendHttpRequestUngated(url: string, options: HttpRequestOptions): Promise<HttpTransportResponse> {", 1) + GATE
    open(p, 'w').write(s)
    assert "destroy();" not in s, p

if __name__ == '__main__':
    patch_files(sys.argv[1:])
