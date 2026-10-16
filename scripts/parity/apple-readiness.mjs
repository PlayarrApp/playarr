const EXPECTED_ROUTES = {
  home: "/",
  movies: "/movies",
  series: "/series",
  music: "/music",
  filters: "/movies?panel=filters",
  actions: "/movies?panel=actions",
};

export function appleScreenForRoute(route) {
  return Object.entries(EXPECTED_ROUTES).find(([, expected]) => expected === route)?.[0] ?? null;
}

export function appleReadinessResult(snapshot, screen, phase = "capture") {
  if (!Object.hasOwn(EXPECTED_ROUTES, screen)) throw new Error(`unsupported Apple readiness screen: ${screen}`);
  if (!["route", "focus", "capture"].includes(phase)) throw new Error(`unsupported Apple readiness phase: ${phase}`);
  const expected = EXPECTED_ROUTES[screen];
  if (snapshot?.route !== expected) return false;
  const contentState = snapshot.contentState;
  if (contentState === "loading" || contentState == null) return false;
  if (contentState === "failed") throw new Error(`Apple ${screen} readiness reached an error state`);
  if (contentState === "empty" || !Number.isInteger(snapshot.items) || snapshot.items <= 0) {
    throw new Error(`Apple ${screen} readiness refused empty route data`);
  }
  if (contentState !== "loaded") throw new Error(`Apple ${screen} readiness has an unknown content state`);
  if (screen === "filters" || screen === "actions") {
    if (snapshot.panelContentState === "loading" || snapshot.panelContentState == null) return false;
    if (snapshot.panelContentState === "failed") throw new Error("Apple filters readiness reached an error state");
    if (snapshot.panelContentState !== "loaded") throw new Error("Apple filters readiness has an unknown panel state");
  }
  if (phase === "focus" && !snapshot.focused) return false;
  return true;
}

export async function waitForAppleReadiness({ screen, phase = "capture", readState, timeoutMs = 30_000, pollMs = 250, clock = {} }) {
  const now = clock.now ?? Date.now;
  const sleep = clock.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const deadline = now() + timeoutMs;
  let previous = "";
  let stable = 0;
  let last = null;
  while (now() < deadline) {
    const snapshot = await readState();
    last = snapshot;
    const ready = appleReadinessResult(snapshot, screen, phase);
    const signature = JSON.stringify({
      route: snapshot.route,
      contentState: snapshot.contentState,
      items: snapshot.items,
      panel: snapshot.route?.split("?")[1] ?? "",
      panelContentState: screen === "filters" || screen === "actions" ? snapshot.panelContentState : undefined,
      focused: phase === "focus" ? snapshot.focused : undefined,
    });
    stable = ready && signature === previous ? stable + 1 : 0;
    if (ready && stable >= 1) return snapshot;
    previous = signature;
    await sleep(Math.min(pollMs, Math.max(0, deadline - now())));
  }
  throw new Error(`Apple ${screen} ${phase} readiness timed out without loaded route data (last state: ${JSON.stringify({ route: last?.route, contentState: last?.contentState, items: last?.items, panelContentState: last?.panelContentState, focused: last?.focused })})`);
}
