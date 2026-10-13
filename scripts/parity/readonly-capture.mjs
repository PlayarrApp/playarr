const PLAYER_ROUTE = /(?:^|[:/])(?:player|playback|play)(?:[-:/?]|$)/i;
export const IOS_NATIVE_ROUTES = Object.freeze({
  "film-detail": "detail:movie:@first",
  "series-detail": "detail:series:@first",
  "player-controls": "player:movie:@first",
});

export function resolveIOSNativeRoute(id, nativeRoutes = IOS_NATIVE_ROUTES) {
  return nativeRoutes[id] ?? id;
}

function option(args, name) {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

function isPlayerScreen(screen, nativeRoutes) {
  return /^player(?:-|$)/i.test(screen.id)
    || isReadOnlyPlayerRoute(resolveIOSNativeRoute(screen.id, nativeRoutes))
    || [screen.route, screen.match, screen.open, screen.native].some((route) => isReadOnlyPlayerRoute(route));
}

export function isReadOnlyPlayerRoute(route) {
  return typeof route === "string" && PLAYER_ROUTE.test(route);
}

export function validateReadOnlyCaptureArgs(args, suite, nativeRoutes = IOS_NATIVE_ROUTES) {
  if (!args.includes("--readonly-capture")) return null;

  const only = option(args, "only");
  if (only !== "screens") throw new Error("read-only capture requires --only screens");
  if (args.some((flag) => ["--reset-progress", "--player", "--reference", "--cases", "--checks"].includes(flag))) {
    throw new Error("read-only capture refuses progress reset, playback, downloads, performance, reference, cases, and checks");
  }

  const selected = option(args, "screens");
  if (typeof selected !== "string" || !selected.trim()) throw new Error("read-only capture requires an explicit non-empty --screens allowlist");
  const screens = selected.split(",").map((value) => value.trim());
  if (screens.some((screen) => !screen) || new Set(screens).size !== screens.length) {
    throw new Error("read-only capture requires a non-empty, duplicate-free --screens allowlist");
  }

  const known = new Map(suite.screens.map((screen) => [screen.id, screen]));
  for (const id of screens) {
    const screen = known.get(id);
    if (!screen || id.toLowerCase() === "all") throw new Error(`read-only capture refuses unknown screen: ${id}`);
    if (isPlayerScreen(screen, nativeRoutes)) throw new Error(`read-only capture refuses player screen: ${id}`);
  }

  const themes = (option(args, "themes") ?? suite.themes.join(",")).split(",").map((value) => value.trim());
  if (!themes.length || themes.some((theme) => !suite.themes.includes(theme)) || new Set(themes).size !== themes.length) {
    throw new Error("read-only capture requires valid, duplicate-free suite themes");
  }
  return { screens, themes };
}
