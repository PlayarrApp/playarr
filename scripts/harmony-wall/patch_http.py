# Preview-only (never committed). Usage: patch_http.py <HttpTransport.ets> <other .ets files with destroy() calls>...
# 1. Previewer's libhttp can crash in HttpExec::ReadResponse while its curl read thread is winding down. Keep each single-use request
#    strongly reachable for the full preview process lifetime and do not destroy it during capture. Dropping the last JS reference can
#    finalise the native handle before that thread has finished, even when explicit destroy() is omitted.
# 2. Home fires one artwork fetch per card (about a hundred at once); through the Previewer's network stack the burst times out or fails
#    and the cards stay blank. HttpTransport's sendHttpRequest is gated to a few requests in flight.
import sys
import re
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
for i, p in enumerate(sys.argv[1:]):
    s = open(p).read()
    if i < 2:
        s = "import { retainPreviewHttpRequest } from '../util/PreviewState';\n" + s
    for variable in ("client", "req"):
        create = f"const {variable} = http.createHttp();"
        pattern = re.compile(rf"(?m)^( *){re.escape(create)}(?!\n\1  retainPreviewHttpRequest\({variable}\);)$")
        s = pattern.sub(lambda match: f"{match.group(1)}{create}\n{match.group(1)}  retainPreviewHttpRequest({variable});", s)
    s = s.replace("client.destroy();", "/* retained until preview process exit (libhttp read-thread lifetime) */")
    s = s.replace("req.destroy();", "/* retained until preview process exit (libhttp read-thread lifetime) */")
    if i == 0 and "PREVIEW_HTTP_ACTIVE" not in s:
        old = "export async function sendHttpRequest(url: string, options: HttpRequestOptions): Promise<HttpTransportResponse> {"
        assert old in s
        s = "import { previewReport } from '../util/PreviewState';\n" + s
        s = s.replace(old, "async function sendHttpRequestUngated(url: string, options: HttpRequestOptions): Promise<HttpTransportResponse> {", 1) + GATE
    open(p, 'w').write(s)
    assert "destroy();" not in s, p
