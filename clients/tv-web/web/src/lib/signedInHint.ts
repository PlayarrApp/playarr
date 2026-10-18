const SIGNED_IN_COOKIE = "playarr_signed_in";

/** Routing hint only, never a credential: lets the playarr.app Worker serve the app instead of the marketing site on "/". */
export function syncSignedInHint(
  hasSessions: boolean,
  doc: { cookie: string } | undefined = typeof document === "undefined" ? undefined : document
): void {
  if (!doc) return;
  doc.cookie = hasSessions
    ? `${SIGNED_IN_COOKIE}=1; Path=/; Max-Age=31536000; SameSite=Lax; Secure`
    : `${SIGNED_IN_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax; Secure`;
}

/** Marks this browser profile as an installed app, so the Worker serves the app (never the marketing site) at "/" even when signed out. */
export function syncInstalledAppHint(
  installed: boolean,
  doc: { cookie: string } | undefined = typeof document === "undefined" ? undefined : document
): void {
  if (!doc || !installed) return;
  doc.cookie = "playarr_app=1; Path=/; Max-Age=31536000; SameSite=Lax; Secure";
}
