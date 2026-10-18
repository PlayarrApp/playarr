// Installed apps and browsers that have run one must never be shown the marketing site at "/" (owner rule, 2026-10-18).
// Signals: a ?platform=<client> marker (the registered VIDAA URL carries one), an app user agent, or an app-set cookie.
// All are routing hints, never credentials.
const PLATFORM_PARAM = /^[a-z][a-z0-9-]{0,31}$/i;
const APP_USER_AGENT = /PlayarrAndroid(?:Mobile|TV)\/|\b(?:VIDAA|Hisense|Xbox)\b/i;
const APP_COOKIE = /(?:^|;\s*)(?:playarr_signed_in|playarr_app)=1(?:;|$)/;

export function isAppRequest(request) {
  const platform = new URL(request.url).searchParams.get("platform");
  return (
    (platform !== null && PLATFORM_PARAM.test(platform)) ||
    APP_USER_AGENT.test(request.headers.get("User-Agent") ?? "") ||
    APP_COOKIE.test(request.headers.get("Cookie") ?? "")
  );
}
