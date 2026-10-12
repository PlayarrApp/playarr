# Preview-only (never committed). Usage: patch_http.py <HttpTransport.ets> <other .ets files with destroy() calls>...
# 1. The Previewer's libhttp crashes (access violation in HttpExec::ReadResponse, the whole app freezes) some of the time when a request
#    object is destroyed while its read thread is still winding down. Leaking the single-use request objects for the length of a capture
#    run is harmless.
# 2. Home fires one artwork fetch per card (about a hundred at once); through the Previewer's network stack the burst times out or fails
#    and the cards stay blank. HttpTransport's sendHttpRequest is gated to a few requests in flight.
import sys
GATE = """
let PREVIEW_HTTP_ACTIVE: number = 0;
const PREVIEW_HTTP_WAITERS: Array<() => void> = [];
const PREVIEW_HTTP_LIMIT: number = 4;

export async function sendHttpRequest(url: string, options: HttpRequestOptions): Promise<HttpTransportResponse> {
  if (PREVIEW_HTTP_ACTIVE >= PREVIEW_HTTP_LIMIT) {
    await new Promise<void>((resolve: () => void): void => {
      PREVIEW_HTTP_WAITERS.push(resolve);
    });
  }
  PREVIEW_HTTP_ACTIVE += 1;
  try {
    return await sendHttpRequestUngated(url, options);
  } finally {
    PREVIEW_HTTP_ACTIVE -= 1;
    const next: (() => void) | undefined = PREVIEW_HTTP_WAITERS.shift();
    if (next !== undefined) {
      next();
    }
  }
}
"""
for i, p in enumerate(sys.argv[1:]):
    s = open(p).read()
    s = s.replace("client.destroy();", "/* request left alive (libhttp crash) */").replace("req.destroy();", "/* request left alive (libhttp crash) */")
    if i == 0 and "PREVIEW_HTTP_ACTIVE" not in s:
        old = "export async function sendHttpRequest(url: string, options: HttpRequestOptions): Promise<HttpTransportResponse> {"
        assert old in s
        s = s.replace(old, "async function sendHttpRequestUngated(url: string, options: HttpRequestOptions): Promise<HttpTransportResponse> {", 1) + GATE
    open(p, 'w').write(s)
    assert "destroy();" not in s, p
