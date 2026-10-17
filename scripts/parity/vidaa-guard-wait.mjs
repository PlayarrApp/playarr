// Waits for the VIDAA device-test guard while the TV page is loading or rendering. The page's heartbeat worker is silent for a while
// after a reload, so a stale or missing heartbeat is retried; any other rejection (another account, wrong server) fails at once.
const RETRYABLE = /heartbeat is stale|no identity heartbeat/;

export function waitForFreshHeartbeat(runGuard, { timeoutMs = 90000, pollMs = 2000, now = Date.now, sleep } = {}) {
  const end = now() + timeoutMs;
  for (;;) {
    const result = runGuard();
    if (result.status === 0) return;
    const message = String(`${result.stdout ?? ""}${result.stderr ?? ""}`).trim();
    if (!RETRYABLE.test(message) || now() > end) {
      throw new Error(`device-test account guard rejected the current session: ${message.slice(0, 80)}`);
    }
    sleep(pollMs);
  }
}
