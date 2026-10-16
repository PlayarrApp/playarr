export function selectedLiveScreens(requestedScreens, groups, groupDefinitions) {
  return requestedScreens.filter((screen) => groups.some((group) => groupDefinitions[group]?.liveScreens?.includes(screen)));
}

export function shouldStampReferenceBuild({ partial, liveScreens = [] }) {
  return !partial && liveScreens.length === 0;
}

export function assertBuildIdentityStable(expected, actual, source = "capture") {
  if (expected !== actual) throw new Error(`${source} build identity changed during capture (${expected} -> ${actual}); nothing copied`);
}

export const captureKey = (group, theme, screen) => `${group}/${theme}/${screen}`;

/** Errors that must abort the run: an account-guard rejection is never retried or skipped. */
export const isGuardRejection = (error) => /guard rejected|allowlist|trusted/.test(String(error?.message ?? error));

/**
 * Run one screen with retries. A guard rejection throws; a screen that fails every attempt is returned as
 * { ok: false, error } so the caller can record it and carry on with the next screen.
 */
export async function runScreenWithRetry(attemptFn, { attempts = 5, waitMs = (n) => 10000 * n, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), log = () => {} } = {}) {
  for (let attempt = 1; ; attempt += 1) {
    try { await attemptFn(); return { ok: true }; }
    catch (error) {
      if (isGuardRejection(error)) throw error;
      const last = attempt >= attempts;
      log(`${last ? "FAIL" : "retry"} (${attempt}): ${String(error.message).split("\n")[0]}`);
      if (last) return { ok: false, error };
      await sleep(waitMs(attempt));
    }
  }
}

/** Keys of every group/theme/screen the publish needs that is not present yet. */
export const missingCaptures = (groups, screens, exists) => groups.flatMap((g) => ["dark", "light"].flatMap((t) => screens.filter((s) => !exists(g, t, s)).map((s) => captureKey(g, t, s))));

/** The targets of a --only / --failed pass, or null for a full pass. */
export function selectTargets({ only = null, failed = false, failedList = [] } = {}) {
  const list = only ? only.split(",").filter(Boolean) : failed ? failedList : null;
  if (list && !list.length) throw new Error(only ? "--only needs group/theme/screen entries" : "no failed screens recorded: nothing to recapture");
  for (const key of list ?? []) if (!/^[^/]+\/(dark|light)\/[^/]+$/.test(key)) throw new Error(`bad target ${key}: use group/theme/screen`);
  return list ? new Set(list) : null;
}
