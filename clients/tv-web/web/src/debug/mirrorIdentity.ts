// DEBUG BUILD ONLY. Receiver trust settings and this code are excluded from normal client builds.
export const MIRROR_ACTIVE_PROFILE_KEY = "playarr.activeProfile.v1";
export const MIRROR_PROFILE_SESSIONS_KEY = "playarr.profileSessions.v4";

/** Wall-clock time even when a capture freezes Date (main.tsx stashes the real clock first). */
export function realNow(): number {
  const real = (globalThis as { __mirrorRealNow?: () => number }).__mirrorRealNow;
  return real ? real() : Date.now();
}

const CONFIG_PATH = "/__mirror/trusted";
const PROFILE_LIST_PATH = "/api/v1/users/profiles";
const REQUEST_TIMEOUT_MS = 5000;

export type MirrorIdentityStatus =
  | "ok"
  | "untrusted_server"
  | "trusted_server_unavailable"
  | "not_allowlisted"
  | "session_changed"
  | "identity_unavailable";

export interface MirrorIdentity {
  status: MirrorIdentityStatus;
  username: string | null;
  isCurrentCount: number;
  serverUrl: string | null;
  checkedAt: number;
  sessionChanged: boolean;
  usernameAllowed: boolean;
  serverMatched: boolean;
  markerPresent: boolean;
  sessionsArray: boolean;
  markerRawChanged: boolean;
  sessionsRawChanged: boolean;
  selectedIdentityChanged: boolean;
  selectedCredentialsChanged: boolean;
  selectedIdentity: string | null;
  selectedCredentials: string | null;
  /** Diagnostics for a failed profile request: HTTP status (0 = network error or timeout) and seconds until the access token expires (negative = expired). */
  profileHttpStatus?: number;
  tokenExpiresInS?: number;
}

export interface MirrorIdentityDependencies {
  storage: Pick<Storage, "getItem">;
  fetch: typeof fetch;
  now: () => number;
  receiverOrigin: string;
}

interface TrustedConfig {
  serverUrl: string;
  allowedUsernames: string[];
}

interface SelectedProfile {
  profileKey: string;
  userId: string;
  apiBaseUrl: string;
  accessToken: string;
  tokenType: string;
  refreshToken: string;
}

function failed(
  status: MirrorIdentityStatus,
  now: () => number,
  details: Partial<MirrorIdentity> = {},
): MirrorIdentity {
  return {
    status,
    username: null,
    isCurrentCount: 0,
    serverUrl: null,
    checkedAt: now(),
    sessionChanged: status === "session_changed",
    usernameAllowed: false,
    serverMatched: false,
    markerPresent: false,
    sessionsArray: false,
    markerRawChanged: false,
    sessionsRawChanged: false,
    selectedIdentityChanged: false,
    selectedCredentialsChanged: false,
    selectedIdentity: null,
    selectedCredentials: null,
    ...details,
  };
}

async function fetchJson(
  fetcher: typeof fetch,
  url: string,
  init: RequestInit = {},
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetcher(url, { ...init, signal: controller.signal });
    if (!response.ok) throw Object.assign(new Error("request failed"), { status: response.status });
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchNoContent(
  fetcher: typeof fetch,
  url: string,
  init: RequestInit = {},
): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetcher(url, { ...init, signal: controller.signal });
    if (!response.ok) throw new Error("request failed");
  } finally {
    clearTimeout(timer);
  }
}

/** Seconds until the access token's `exp` claim (negative once expired); undefined when it is not a readable JWT. */
function secondsUntilExpiry(accessToken: string, nowMs: number): number | undefined {
  try {
    const part = accessToken.split(".")[1] ?? "";
    const exp = (JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/"))) as { exp?: unknown }).exp;
    return typeof exp === "number" ? Math.round(exp - nowMs / 1000) : undefined;
  } catch {
    return undefined;
  }
}

function canonicalServerUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return `${url.origin}${url.pathname.replace(/\/$/, "")}`;
  } catch {
    return null;
  }
}

function selectProfile(markerRaw: string | null, sessionsRaw: string | null): SelectedProfile | null {
  try {
    const marker = JSON.parse(markerRaw ?? "null") as Partial<{
      profileKey: string;
      userId: string;
      apiBaseUrl: string;
    }> | null;
    const sessions = JSON.parse(sessionsRaw ?? "null") as unknown;
    if (
      !marker || typeof marker.profileKey !== "string" || typeof marker.userId !== "string" ||
      typeof marker.apiBaseUrl !== "string" || !Array.isArray(sessions)
    ) return null;
    const markerServer = canonicalServerUrl(marker.apiBaseUrl);
    const matches = sessions.filter((value): value is Record<string, unknown> => {
      if (!value || typeof value !== "object") return false;
      return value.profileKey === marker.profileKey && value.userId === marker.userId &&
        canonicalServerUrl(String(value.apiBaseUrl ?? "")) === markerServer;
    });
    if (matches.length !== 1) return null;
    const profile = matches[0];
    if (!profile) return null;
    const session = profile.session as Record<string, unknown> | undefined;
    if (
      typeof profile.profileKey !== "string" || typeof profile.userId !== "string" ||
      typeof profile.apiBaseUrl !== "string" || !session ||
      typeof session.accessToken !== "string" || !session.accessToken ||
      typeof session.tokenType !== "string" || !session.tokenType ||
      typeof session.refreshToken !== "string"
    ) return null;
    return {
      profileKey: profile.profileKey,
      userId: profile.userId,
      apiBaseUrl: profile.apiBaseUrl,
      accessToken: session.accessToken,
      tokenType: session.tokenType,
      refreshToken: session.refreshToken,
    };
  } catch {
    return null;
  }
}

export const LIVE_SESSION_KEY = "playarr:session";

/** The access token's `sub` claim (unverified; only used to tie the live session to the selected profile). */
function tokenSubject(accessToken: string): string | undefined {
  try {
    const part = accessToken.split(".")[1] ?? "";
    const sub = (JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/"))) as { sub?: unknown }).sub;
    return typeof sub === "string" ? sub : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The app refreshes its access token in its live session (`playarr:session`) and copies it into the saved profile only
 * sometimes, so the saved copy goes stale after the first refresh (15 minutes). When the live session belongs to the
 * same user, use its credentials: they are the ones the app is actually signed in with.
 */
function withLiveCredentials(selected: SelectedProfile | null, storage: Pick<Storage, "getItem">): SelectedProfile | null {
  if (!selected) return selected;
  try {
    const live = JSON.parse(storage.getItem(LIVE_SESSION_KEY) ?? "null") as Partial<Record<"accessToken" | "tokenType" | "refreshToken", unknown>> | null;
    if (
      live && typeof live.accessToken === "string" && live.accessToken && typeof live.tokenType === "string" && live.tokenType &&
      typeof live.refreshToken === "string" && tokenSubject(live.accessToken) === selected.userId
    ) return { ...selected, accessToken: live.accessToken, tokenType: live.tokenType, refreshToken: live.refreshToken };
  } catch {
    // unreadable live session: keep the saved credentials
  }
  return selected;
}

/** The selected profile's server, user and Authorization value, read synchronously from storage (no network); null when unavailable. */
export function readSelectedSession(storage: Pick<Storage, "getItem">): { userId: string; serverUrl: string; auth: string } | null {
  try {
    const selected = withLiveCredentials(selectProfile(storage.getItem(MIRROR_ACTIVE_PROFILE_KEY), storage.getItem(MIRROR_PROFILE_SESSIONS_KEY)), storage);
    const serverUrl = selected && canonicalServerUrl(selected.apiBaseUrl);
    return selected && serverUrl ? { userId: selected.userId, serverUrl, auth: `${selected.tokenType} ${selected.accessToken}` } : null;
  } catch {
    return null;
  }
}

export function sameMirrorIdentity(left: MirrorIdentity, right: MirrorIdentity): boolean {
  return Boolean(
    left.status === "ok" && right.status === "ok" &&
    left.selectedIdentity !== null && left.selectedIdentity === right.selectedIdentity &&
    left.selectedCredentials !== null && left.selectedCredentials === right.selectedCredentials
  );
}

export function revalidateMirrorIdentity(
  initial: MirrorIdentity,
  current: MirrorIdentity,
): MirrorIdentity {
  if (sameMirrorIdentity(initial, current)) return current;
  return {
    ...current,
    status: current.status === "ok" ? "session_changed" : current.status,
    sessionChanged: current.status === "ok" || current.sessionChanged,
    selectedIdentityChanged: initial.selectedIdentity !== current.selectedIdentity,
    selectedCredentialsChanged: initial.selectedCredentials !== current.selectedCredentials,
  };
}

/**
 * Verify the active saved profile against receiver-provided trust settings and the server's
 * authenticated profile list. The selected identity and credential tuples stay in memory only.
 */
export async function readMirrorIdentity(
  token: string,
  dependencies?: MirrorIdentityDependencies,
): Promise<MirrorIdentity> {
  const { storage, fetch: fetcher, now, receiverOrigin } = dependencies ?? {
    storage: window.localStorage,
    fetch: window.fetch.bind(window),
    now: realNow,
    receiverOrigin: window.location.origin,
  };
  let markerRaw: string | null;
  let sessionsRaw: string | null;
  try {
    markerRaw = storage.getItem(MIRROR_ACTIVE_PROFILE_KEY);
    sessionsRaw = storage.getItem(MIRROR_PROFILE_SESSIONS_KEY);
  } catch {
    return failed("identity_unavailable", now);
  }
  const markerPresent = markerRaw !== null;
  let sessionsArray = false;
  try {
    sessionsArray = Array.isArray(JSON.parse(sessionsRaw ?? "null"));
  } catch {
    // Report malformed storage without including its contents.
  }
  const selected = withLiveCredentials(selectProfile(markerRaw, sessionsRaw), storage);
  if (!selected) return failed("identity_unavailable", now, { markerPresent, sessionsArray });

  let trusted: TrustedConfig;
  try {
    const value = await fetchJson(
      fetcher,
      `${receiverOrigin}${CONFIG_PATH}?t=${encodeURIComponent(token)}`,
    ) as Partial<TrustedConfig>;
    if (typeof value.serverUrl !== "string" || !Array.isArray(value.allowedUsernames) ||
      !value.allowedUsernames.every((name) => typeof name === "string")) {
      return failed("trusted_server_unavailable", now, { markerPresent, sessionsArray });
    }
    trusted = value as TrustedConfig;
  } catch {
    return failed("trusted_server_unavailable", now, { markerPresent, sessionsArray });
  }

  const trustedServer = canonicalServerUrl(trusted.serverUrl);
  const selectedServer = canonicalServerUrl(selected.apiBaseUrl);
  if (!trustedServer || !selectedServer || trustedServer !== selectedServer) {
    return failed("untrusted_server", now, { markerPresent, sessionsArray, serverUrl: selectedServer });
  }

  let profiles: unknown;
  try {
    profiles = await fetchJson(fetcher, `${trustedServer}${PROFILE_LIST_PATH}`, {
      headers: { Authorization: `${selected.tokenType} ${selected.accessToken}` },
    });
  } catch (error) {
    const status = (error as { status?: unknown } | null)?.status;
    return failed("trusted_server_unavailable", now, {
      markerPresent, sessionsArray, serverMatched: true, serverUrl: selectedServer,
      profileHttpStatus: typeof status === "number" ? status : 0,
      tokenExpiresInS: secondsUntilExpiry(selected.accessToken, now()),
    });
  }

  let markerAfter: string | null;
  let sessionsAfter: string | null;
  try {
    markerAfter = storage.getItem(MIRROR_ACTIVE_PROFILE_KEY);
    sessionsAfter = storage.getItem(MIRROR_PROFILE_SESSIONS_KEY);
  } catch {
    return failed("identity_unavailable", now, { markerPresent, sessionsArray, serverMatched: true });
  }
  const selectedAfter = withLiveCredentials(selectProfile(markerAfter, sessionsAfter), storage);
  const selectedIdentity = JSON.stringify([selected.profileKey, selected.userId, selectedServer]);
  const selectedCredentials = JSON.stringify([selected.accessToken, selected.tokenType, selected.refreshToken]);
  const selectedIdentityAfter = selectedAfter
    ? JSON.stringify([selectedAfter.profileKey, selectedAfter.userId, canonicalServerUrl(selectedAfter.apiBaseUrl)])
    : null;
  const selectedCredentialsAfter = selectedAfter
    ? JSON.stringify([selectedAfter.accessToken, selectedAfter.tokenType, selectedAfter.refreshToken])
    : null;
  const markerRawChanged = markerAfter !== markerRaw;
  const sessionsRawChanged = sessionsAfter !== sessionsRaw;
  const selectedIdentityChanged = selectedIdentityAfter !== selectedIdentity;
  const selectedCredentialsChanged = selectedCredentialsAfter !== selectedCredentials;
  if (markerRawChanged || sessionsRawChanged || selectedIdentityChanged || selectedCredentialsChanged) {
    return failed("session_changed", now, {
      markerPresent: markerAfter !== null,
      sessionsArray,
      serverMatched: true,
      markerRawChanged,
      sessionsRawChanged,
      selectedIdentityChanged,
      selectedCredentialsChanged,
    });
  }

  if (!Array.isArray(profiles)) {
    return failed("identity_unavailable", now, { markerPresent, sessionsArray, serverMatched: true });
  }
  const currentProfiles = profiles.filter((profile) => Boolean(
    profile && typeof profile === "object" && (profile as { is_current?: unknown }).is_current === true
  )) as Array<{ id?: unknown; username?: unknown }>;
  const current = currentProfiles[0];
  if (currentProfiles.length !== 1 || current?.id !== selected.userId || typeof current.username !== "string") {
    return failed("identity_unavailable", now, {
      markerPresent, sessionsArray, serverMatched: true,
      selectedIdentity, selectedCredentials,
    });
  }
  const usernameAllowed = trusted.allowedUsernames.includes(current.username);
  const result = failed(usernameAllowed ? "ok" : "not_allowlisted", now, {
    username: current.username,
    isCurrentCount: currentProfiles.length,
    serverUrl: selectedServer,
    usernameAllowed,
    serverMatched: true,
    markerPresent,
    sessionsArray,
    selectedIdentity,
    selectedCredentials,
  });
  return result;
}

/** Construct the only identity fields permitted in a frame payload. */
export function publicMirrorIdentity(identity: MirrorIdentity): Record<string, unknown> {
  return {
    status: identity.status,
    username: identity.username,
    isCurrentCount: identity.isCurrentCount,
    serverUrl: identity.serverUrl,
    checkedAt: identity.checkedAt,
    sessionChanged: identity.sessionChanged,
  };
}

export function mirrorFramePayload(
  snapshot: Record<string, unknown>,
  identity: MirrorIdentity,
): Record<string, unknown> {
  return { ...snapshot, identity: publicMirrorIdentity(identity) };
}

/** Send receiver diagnostics using an explicit allow-list that excludes identity and credential tuples. */
export async function reportMirrorIdentityStatus(
  identity: MirrorIdentity,
  token: string,
  fetcher: typeof fetch = window.fetch.bind(window),
  receiverOrigin = window.location.origin,
): Promise<void> {
  const payload = {
    status: identity.status,
    checkedAt: identity.checkedAt,
    sessionChanged: identity.sessionChanged,
    isCurrentCount: identity.isCurrentCount,
    usernameAllowed: identity.usernameAllowed,
    serverMatched: identity.serverMatched,
    markerPresent: identity.markerPresent,
    sessionsArray: identity.sessionsArray,
    markerRawChanged: identity.markerRawChanged,
    sessionsRawChanged: identity.sessionsRawChanged,
    selectedIdentityChanged: identity.selectedIdentityChanged,
    selectedCredentialsChanged: identity.selectedCredentialsChanged,
    profileHttpStatus: identity.profileHttpStatus,
    tokenExpiresInS: identity.tokenExpiresInS,
  };
  await fetchNoContent(fetcher, `${receiverOrigin}/__mirror/identity-status?t=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}
