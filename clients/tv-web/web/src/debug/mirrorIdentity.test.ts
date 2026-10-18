import { describe, expect, it, vi } from "vitest";
import {
  LIVE_SESSION_KEY,
  MIRROR_ACTIVE_PROFILE_KEY,
  MIRROR_PROFILE_SESSIONS_KEY,
  mirrorFramePayload,
  readMirrorIdentity,
  readSelectedSession,
  revalidateMirrorIdentity,
  reportMirrorIdentityStatus,
  type MirrorIdentityDependencies,
} from "./mirrorIdentity";

const marker = JSON.stringify({ profileKey: "profile-a", userId: "user-a", apiBaseUrl: "https://server.example" });
const session = (accessToken = "access-sentinel", refreshToken = "refresh-sentinel") => JSON.stringify([{
  profileKey: "profile-a",
  userId: "user-a",
  apiBaseUrl: "https://server.example",
  session: { accessToken, refreshToken, tokenType: "Bearer", expiresAt: 1 },
}]);

function fixture(options: {
  allowed?: string[];
  trustedServer?: string;
  profiles?: unknown;
  getItem?: (key: string) => string | null;
  now?: () => number;
} = {}) {
  const values = new Map([
    [MIRROR_ACTIVE_PROFILE_KEY, marker],
    [MIRROR_PROFILE_SESSIONS_KEY, session()],
  ]);
  const getItem = options.getItem ?? ((key: string) => values.get(key) ?? null);
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, init });
    if (url.startsWith("https://receiver.example/__mirror/trusted")) {
      return Response.json({ serverUrl: options.trustedServer ?? "https://server.example", allowedUsernames: options.allowed ?? ["qa-user"] });
    }
    if (url === "https://server.example/api/v1/users/profiles") {
      return Response.json(options.profiles ?? [{ id: "user-a", username: "qa-user", is_current: true }]);
    }
    if (url.startsWith("https://receiver.example/__mirror/identity-status")) {
      return new Response(null, { status: 204 });
    }
    throw new Error("unexpected request");
  }) as unknown as typeof fetch;
  const dependencies: MirrorIdentityDependencies = {
    storage: { getItem },
    fetch: fetcher,
    now: options.now ?? (() => 123456),
    receiverOrigin: "https://receiver.example",
  };
  return { dependencies, requests, values };
}

describe("debug mirror identity guard", () => {
  it("verifies receiver trust and the active saved session without requiring refresh-token contents", async () => {
    const f = fixture();
    const result = await readMirrorIdentity("receiver-token", f.dependencies);
    expect(result.status).toBe("ok");
    expect(result.checkedAt).toBe(123456);
    expect(f.requests[0]?.url).toBe("https://receiver.example/__mirror/trusted?t=receiver-token");
    expect(f.requests[1]?.init?.headers).toEqual({ Authorization: "Bearer access-sentinel" });
    expect(f.requests[0]?.url).not.toContain("access-sentinel");
    expect(result.selectedCredentials).toContain("refresh-sentinel");

    const emptyRefresh = fixture();
    emptyRefresh.values.set(MIRROR_PROFILE_SESSIONS_KEY, session("access-sentinel", ""));
    expect((await readMirrorIdentity("receiver-token", emptyRefresh.dependencies)).status).toBe("ok");
  });

  it("does not send credentials when the selected server is outside receiver trust", async () => {
    const f = fixture({ trustedServer: "https://other.example" });
    const result = await readMirrorIdentity("receiver-token", f.dependencies);
    expect(result.status).toBe("untrusted_server");
    expect(f.requests).toHaveLength(1);
    expect(f.requests[0]?.url).not.toContain("access-sentinel");
    expect(f.requests[0]?.init?.headers).toBeUndefined();
  });

  it("rejects usernames outside the receiver allow-list and server responses for another user", async () => {
    const notAllowed = await readMirrorIdentity("receiver-token", fixture({ allowed: ["someone-else"] }).dependencies);
    expect(notAllowed.status).toBe("not_allowlisted");

    const wrongUser = await readMirrorIdentity("receiver-token", fixture({
      profiles: [{ id: "different-user", username: "qa-user", is_current: true }],
    }).dependencies);
    expect(wrongUser.status).toBe("identity_unavailable");
  });

  it("rejects profile or credential changes between pre-render and post-render verification", async () => {
    const first = await readMirrorIdentity("receiver-token", fixture().dependencies);
    const changedCredentials = await readMirrorIdentity("receiver-token", fixture({
      getItem: (key) => key === MIRROR_ACTIVE_PROFILE_KEY ? marker : session("rotated-access", "rotated-refresh"),
    }).dependencies);
    const rejected = revalidateMirrorIdentity(first, changedCredentials);
    expect(rejected.status).toBe("session_changed");
    expect(rejected.selectedCredentialsChanged).toBe(true);
    expect(rejected.selectedIdentityChanged).toBe(false);

    const changedAccount = await readMirrorIdentity("receiver-token", fixture({
      getItem: (key) => key === MIRROR_ACTIVE_PROFILE_KEY
        ? JSON.stringify({ profileKey: "profile-b", userId: "user-a", apiBaseUrl: "https://server.example" })
        : JSON.stringify([{
          profileKey: "profile-b", userId: "user-a", apiBaseUrl: "https://server.example",
          session: { accessToken: "access-sentinel", refreshToken: "refresh-sentinel", tokenType: "Bearer", expiresAt: 1 },
        }]),
    }).dependencies);
    const accountRejected = revalidateMirrorIdentity(first, changedAccount);
    expect(accountRejected.status).toBe("session_changed");
    expect(accountRejected.selectedIdentityChanged).toBe(true);
  });

  it("keeps the fresh post-render verification timestamp when identity is unchanged", async () => {
    let now = 0;
    const deps = fixture({ now: () => ++now }).dependencies;
    const beforeRender = await readMirrorIdentity("receiver-token", deps);
    const afterRender = await readMirrorIdentity("receiver-token", deps);
    const accepted = revalidateMirrorIdentity(beforeRender, afterRender);
    expect(accepted.status).toBe("ok");
    expect(accepted.checkedAt).toBe(afterRender.checkedAt);
    expect(accepted.checkedAt).toBeGreaterThan(beforeRender.checkedAt);
  });

  it("does not serialize the selected identity or credential tuple into the frame", async () => {
    const identity = await readMirrorIdentity("receiver-token", fixture().dependencies);
    const snapshot = {
      sentinel: "debug-snapshot",
      seq: 7,
      reason: "interval",
      at: 123450,
      captureMs: 6000,
      viewport: { w: 1280, h: 720, dpr: 1 },
      screen: { w: 1280, h: 720 },
      env: { theme: "dark" },
      route: "/",
      focus: null,
      text: [],
      userAgent: "test-agent",
      errors: [],
      captureError: null,
      image: "data:image/png;base64,AA==",
    };
    const payload = mirrorFramePayload(snapshot, identity);
    const serialised = JSON.stringify(payload);
    expect(payload).toMatchObject(snapshot);
    expect(serialised).not.toContain("access-sentinel");
    expect(serialised).not.toContain("refresh-sentinel");
    expect(serialised).not.toContain("selectedIdentity");
    expect(serialised).not.toContain("selectedCredentials");
    expect(Object.keys(payload.identity as object).sort()).toEqual([
      "checkedAt", "isCurrentCount", "serverUrl", "sessionChanged", "status", "username",
    ]);
  });

  it("reports only allow-listed diagnostics and accepts the receiver's no-content response", async () => {
    const f = fixture();
    const identity = await readMirrorIdentity("receiver-token", f.dependencies);
    identity.selectedCredentials = "credential-sentinel";
    await reportMirrorIdentityStatus(identity, "receiver-token", f.dependencies.fetch, f.dependencies.receiverOrigin);
    const request = f.requests.at(-1);
    expect(request?.url).toBe("https://receiver.example/__mirror/identity-status?t=receiver-token");
    const statusBody = JSON.parse(String(request?.init?.body)) as Record<string, unknown>;
    expect(Object.keys(statusBody).sort()).toEqual([
      "checkedAt", "isCurrentCount", "markerPresent", "markerRawChanged", "selectedCredentialsChanged",
      "selectedIdentityChanged", "serverMatched", "sessionChanged", "sessionsArray", "sessionsRawChanged",
      "status", "usernameAllowed",
    ]);
    expect(JSON.stringify(statusBody)).not.toContain("credential-sentinel");
    expect(statusBody).not.toHaveProperty("selectedCredentials");
    expect(request?.init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("fails closed when browser storage is unavailable", async () => {
    const f = fixture({ getItem: () => { throw new Error("blocked"); } });
    const result = await readMirrorIdentity("receiver-token", f.dependencies);
    expect(result.status).toBe("identity_unavailable");
    expect(f.requests).toHaveLength(0);
  });

  it("fails closed when storage becomes unavailable during the authenticated lookup", async () => {
    let reads = 0;
    const f = fixture({ getItem: (key) => {
      reads += 1;
      if (reads > 2) throw new Error("storage became unavailable");
      return key === MIRROR_ACTIVE_PROFILE_KEY ? marker : session();
    } });
    const result = await readMirrorIdentity("receiver-token", f.dependencies);
    expect(result.status).toBe("identity_unavailable");
    expect(result.serverMatched).toBe(true);
    expect(f.requests).toHaveLength(2);
  });
});

describe("readSelectedSession", () => {
  it("returns the selected server, user and authorisation, and follows a token rotation", () => {
    const values = new Map([[MIRROR_ACTIVE_PROFILE_KEY, marker], [MIRROR_PROFILE_SESSIONS_KEY, session("old-token")]]);
    const storage = { getItem: (key: string) => values.get(key) ?? null };
    expect(readSelectedSession(storage)).toEqual({ userId: "user-a", serverUrl: "https://server.example", auth: "Bearer old-token" });
    values.set(MIRROR_PROFILE_SESSIONS_KEY, session("new-token"));
    expect(readSelectedSession(storage)?.auth).toBe("Bearer new-token");
    values.delete(MIRROR_ACTIVE_PROFILE_KEY);
    expect(readSelectedSession(storage)).toBeNull();
  });

  it("prefers the app's live session when it belongs to the selected user (the saved copy goes stale after a refresh)", () => {
    const jwt = (sub: string) => `h.${btoa(JSON.stringify({ sub })).replace(/=+$/, "")}.s`;
    const values = new Map([[MIRROR_ACTIVE_PROFILE_KEY, marker], [MIRROR_PROFILE_SESSIONS_KEY, session("stale-token")]]);
    const storage = { getItem: (key: string) => values.get(key) ?? null };
    values.set(LIVE_SESSION_KEY, JSON.stringify({ accessToken: jwt("user-a"), refreshToken: "r", tokenType: "Bearer", expiresAt: 1 }));
    expect(readSelectedSession(storage)?.auth).toBe(`Bearer ${jwt("user-a")}`);
    values.set(LIVE_SESSION_KEY, JSON.stringify({ accessToken: jwt("someone-else"), refreshToken: "r", tokenType: "Bearer", expiresAt: 1 }));
    expect(readSelectedSession(storage)?.auth).toBe("Bearer stale-token");
    values.set(LIVE_SESSION_KEY, "not json");
    expect(readSelectedSession(storage)?.auth).toBe("Bearer stale-token");
  });
});

describe("expired access token on an idle app", () => {
  const jwt = (exp: number) => `h.${btoa(JSON.stringify({ sub: "user-a", exp })).replace(/=+$/, "")}.s`;

  it("keeps the verdict verified for the same token once it has expired, and fails for an unverified one", async () => {
    const sessionFor = (access: string) => (key: string) => key === MIRROR_ACTIVE_PROFILE_KEY ? marker : session(access, "r-idle");
    const valid = fixture({ getItem: sessionFor(jwt(200)), now: () => 100_000 });
    expect((await readMirrorIdentity("receiver-token", valid.dependencies)).status).toBe("ok");

    const expired = fixture({ getItem: sessionFor(jwt(200)), now: () => 400_000 });
    const rejecting = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).endsWith("/users/profiles") ? new Response("{}", { status: 401 }) : expired.dependencies.fetch(input, init)) as unknown as typeof fetch;
    const again = await readMirrorIdentity("receiver-token", { ...expired.dependencies, fetch: rejecting });
    expect(again.status).toBe("ok");
    expect(again.username).toBe("qa-user");
    expect(again.checkedAt).toBe(400_000);

    const other = fixture({ getItem: sessionFor(jwt(199)), now: () => 400_000 });
    const refused = await readMirrorIdentity("receiver-token", { ...other.dependencies, fetch: rejecting });
    expect(refused.status).toBe("trusted_server_unavailable");
    expect(refused.profileHttpStatus).toBe(401);
  });
});
