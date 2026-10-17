import test from "node:test";
import assert from "node:assert/strict";
import { hostname } from "node:os";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { withCaptureState, captureCanonicalState, withCanonicalState, resolveCaptureEnvironment, parseAndroidDeviceSession, assertAndroidDeviceAccount } from "./capture-state.mjs";
import { clientSecretKeys, parityCredentials } from "./dpad-account.mjs";

const FILE_A = "12345678-1234-4234-8234-1234567890ab";
const FILE_B = "abcdefab-cdef-4abc-8def-abcdefabcdef";
const SERIES = "11111111-1111-4111-8111-111111111111";
const MOVIE = "22222222-2222-4222-8222-222222222222";
const EPISODE = "33333333-3333-4333-8333-333333333333";
const BROKEN = "44444444-4444-4444-8444-444444444444";
const serverUrl = "https://example.invalid";
const creds = { PLAYARR_PARITY_WEB_CAPTURE_10620_USERNAME: "fixture-user", PLAYARR_PARITY_WEB_CAPTURE_10620_PASSWORD: "fixture-pass" };

function mockApi(initial = [], { expireFirstToken = false } = {}) {
  const rows = new Map(initial.map((row) => [row.media_file_id, structuredClone(row)]));
  const calls = [];
  let railPreferences = { rails: [{ id: "home", hidden: false }, { id: "continue", hidden: true }] };
  let playerPreferences = { preferred_audio_language: "en" };
  let failPreferenceRestore = false;
  let expired = false;
  let loginCount = 0;
  globalThis.fetch = async (url, options = {}) => {
    const path = new URL(url).pathname;
    calls.push({ path, method: options.method ?? "GET" });
    if (path.endsWith("/auth/login")) { loginCount++; return new Response(JSON.stringify({ access_token: loginCount === 1 ? "fixture-token" : `fixture-token-${loginCount}` }), { status: 200 }); }
    if (expired && options.headers?.authorization === "Bearer fixture-token") { expired = false; return new Response("expired", { status: 401 }); }
    if (path.endsWith(`/${["home", "rails", "preferences"].join("/")}`)) {
      if (options.method === "PUT") { railPreferences = { rails: JSON.parse(options.body).order.map((id) => ({ id, hidden: JSON.parse(options.body).hidden.includes(id) })) }; return new Response(JSON.stringify(railPreferences), { status: 200 }); }
      return new Response(JSON.stringify(railPreferences), { status: 200 });
    }
    if (path.endsWith("/users/me/player-preferences")) {
      if (options.method === "PATCH") {
        if (failPreferenceRestore) { failPreferenceRestore = false; return new Response("failed", { status: 500 }); }
        playerPreferences = JSON.parse(options.body); return new Response(JSON.stringify(playerPreferences), { status: 200 });
      }
      return new Response(JSON.stringify(playerPreferences), { status: 200 });
    }
    if (path.endsWith("/playback/progress")) return new Response(JSON.stringify([...rows.values()]), { status: 200 });
    const resumePlan = path.match(/\/catalog\/([0-9a-f-]+)\/resume-plan(\/choices)?$/i);
    if (resumePlan && !resumePlan[2]) {
      if (resumePlan[1] === SERIES) return new Response(JSON.stringify({}), { status: 200 });
      if (resumePlan[1] === BROKEN) return new Response("failed", { status: 500 });
      return new Response("not a series", { status: 404 });
    }
    if (resumePlan && resumePlan[2] && options.method === "DELETE") return new Response(null, { status: 204 });
    const match = path.match(/\/playback\/([0-9a-f-]+)\/progress$/i);
    if (match && options.method === "PUT") {
      const value = JSON.parse(options.body);
      rows.set(match[1], { media_file_id: match[1], ...value, state: value.completed ? "watched" : value.position_ms > 0 ? "part_watched" : "unseen" });
      return new Response(JSON.stringify(rows.get(match[1])), { status: 200 });
    }
    if (match) return new Response(JSON.stringify(rows.get(match[1]) ?? { media_file_id: match[1], position_ms: 0, duration_ms: 0, state: "unseen" }), { status: 200 });
    throw new Error(`unexpected API request ${path}`);
  };
  return { rows, calls, get loginCount() { return loginCount; }, expireCurrentToken() { if (expireFirstToken) expired = true; }, failNextPreferenceRestore() { failPreferenceRestore = true; } };
}

const SCRATCH_ROOT = process.env.PLAYARR_PARITY_TEST_OUT;
if (!SCRATCH_ROOT) throw new Error("PLAYARR_PARITY_TEST_OUT must name a task-specific .data scratch directory");
async function scratch() { await mkdir(SCRATCH_ROOT, { recursive: true, mode: 0o700 }); return mkdtemp(join(SCRATCH_ROOT, "lock-")); }
function context(lockDir) { return { client: "web-capture-10620", files: [FILE_A], env: { PLAYARR_SERVER_URL: serverUrl, PARITY_LOCK_DIR: lockDir }, secrets: creds, persistSecrets() {} }; }

test("client credentials require the isolated client and never fall back to shared D-pad credentials", () => {
  assert.deepEqual(clientSecretKeys("web-capture-10620"), {
    username: "PLAYARR_PARITY_WEB_CAPTURE_10620_USERNAME",
    password: "PLAYARR_PARITY_WEB_CAPTURE_10620_PASSWORD",
  });
  assert.deepEqual(parityCredentials({ PARITY_CLIENT: "web-capture-10620" }, creds), { username: "fixture-user", password: "fixture-pass" });
  assert.deepEqual(parityCredentials({ PARITY_ACCOUNT: "dpad" }, { PLAYARR_DEVICE_TEST_DPAD_USERNAME: "legacy-user", PLAYARR_DEVICE_TEST_DPAD_PASSWORD: "legacy-pass" }), { username: "legacy-user", password: "legacy-pass" });
  assert.throws(() => parityCredentials({ PARITY_CLIENT: "web-capture-10620" }, { PLAYARR_DEVICE_TEST_USERNAME: "shared", PLAYARR_DEVICE_TEST_PASSWORD: "shared" }), /missing client account credentials/);
});

test("Android D-pad credentials require the explicit guarded alias and use only dedicated device-test keys", () => {
  const env = { PARITY_DEVICE_ACCOUNT_GUARD: "android", PARITY_USE_DEVICE_TEST_DPAD: "1", PLAYARR_SERVER_URL: serverUrl };
  const secrets = { PLAYARR_DEVICE_TEST_DPAD_USERNAME: "dpad-user", PLAYARR_DEVICE_TEST_DPAD_PASSWORD: "dpad-pass", PLAYARR_PARITY_WEB_CAPTURE_10620_USERNAME: "fixture-user", PLAYARR_PARITY_WEB_CAPTURE_10620_PASSWORD: "fixture-pass" };
  const resolved = resolveCaptureEnvironment("web-capture-10620", env, secrets);
  assert.deepEqual([resolved.PLAYARR_USERNAME, resolved.PLAYARR_PASSWORD], ["dpad-user", "dpad-pass"]);
  assert.deepEqual([resolved.PARITY_USERNAME_KEY, resolved.PARITY_PASSWORD_KEY], ["PLAYARR_DEVICE_TEST_DPAD_USERNAME", "PLAYARR_DEVICE_TEST_DPAD_PASSWORD"]);
  assert.throws(() => resolveCaptureEnvironment("web-capture-10620", { ...env, PARITY_DEVICE_ACCOUNT_GUARD: undefined }, secrets), /require the Android device account guard/);
  assert.throws(() => resolveCaptureEnvironment("web-capture-10620", { PARITY_DEVICE_ACCOUNT_GUARD: "android", PLAYARR_SERVER_URL: serverUrl }, secrets), /requires the explicit D-pad account alias/);
  assert.throws(() => resolveCaptureEnvironment("web-capture-10620", env, { PLAYARR_PARITY_WEB_CAPTURE_10620_USERNAME: "fixture-user", PLAYARR_PARITY_WEB_CAPTURE_10620_PASSWORD: "fixture-pass" }), /missing explicitly selected parity account credentials/);
});

test("Android DataStore session parser uses PreferencesProto wire schema and account guard uses device token", async () => {
  const varint = (value) => { const bytes = []; while (value > 127) { bytes.push((value & 127) | 128); value >>>= 7; } bytes.push(value); return Buffer.from(bytes); };
  const field = (number, value) => Buffer.concat([varint((number << 3) | 2), varint(value.length), value]);
  const stringValue = (text) => field(5, Buffer.from(text));
  const entry = (key, encodedValue) => Buffer.concat([field(1, Buffer.from(key)), field(2, encodedValue)]);
  const data = Buffer.concat(["playarr_access_token=device-token", "playarr_current_server_url=https://example.invalid", "playarr_user_id=fixture-id"].map((pair) => {
    const [key, value] = pair.split("=");
    return field(1, entry(key, stringValue(value)));
  })).toString("hex");
  const session = parseAndroidDeviceSession(data);
  assert.deepEqual(session, { accessToken: "device-token", serverUrl, userId: "fixture-id" });
  let request;
  const fetchImpl = async (url, options) => { request = { url, options }; return { ok: true, async json() { return [{ id: "fixture-id", username: "fixture-user", is_current: true }]; } }; };
  assert.equal(await assertAndroidDeviceAccount({ session, expectedUsername: "fixture-user", expectedServerUrl: serverUrl, fetchImpl }), true);
  assert.equal(request.options.headers.authorization, "Bearer device-token");
  await assert.rejects(assertAndroidDeviceAccount({ session: { ...session, userId: "other-id" }, expectedUsername: "fixture-user", expectedServerUrl: serverUrl, fetchImpl }), /does not match/);
  await assert.rejects(assertAndroidDeviceAccount({ session, expectedUsername: "fixture-user", expectedServerUrl: "https://other.example.invalid", fetchImpl }), /does not match/);
  await assert.rejects(assertAndroidDeviceAccount({ session, expectedUsername: "other-user", expectedServerUrl: serverUrl, fetchImpl }), /does not match/);
  await assert.rejects(assertAndroidDeviceAccount({ session, expectedUsername: "fixture-user", expectedServerUrl: serverUrl, fetchImpl: async () => ({ ok: true, async json() { return []; } }) }), /does not match/);
  await assert.rejects(assertAndroidDeviceAccount({ session, expectedUsername: "fixture-user", expectedServerUrl: serverUrl, fetchImpl: async () => ({ ok: true, async json() { return [{ id: "fixture-id", username: "fixture-user", is_current: true }, { id: "other-id", username: "other-user", is_current: true }]; } }) }), /does not match/);
  await assert.rejects(assertAndroidDeviceAccount({ session, expectedUsername: "fixture-user", expectedServerUrl: serverUrl, fetchImpl: async () => { throw new Error("fixture network failure"); } }), /identity check failed/);
});

test("legacy no-client env command still reports the D-pad key names", async () => {
  await mkdir(SCRATCH_ROOT, { recursive: true, mode: 0o700 });
  const home = await mkdtemp(join(SCRATCH_ROOT, "legacy-cli-"));
  await writeFile(join(home, ".secrets"), "", { mode: 0o600 });
  const output = execFileSync(process.execPath, [new URL("./dpad-account.mjs", import.meta.url).pathname, "env"], {
    encoding: "utf8",
    env: { ...process.env, HOME: home },
  }).trim();
  assert.equal(output, "PLAYARR_DEVICE_TEST_DPAD_USERNAME PLAYARR_DEVICE_TEST_DPAD_PASSWORD");
});

test("snapshot hash is stable and restore resets rows created during playback", async () => {
  const lockDir = await scratch();
  const api = mockApi([{ media_file_id: FILE_A, position_ms: 15_098, duration_ms: 6_742_000, state: "part_watched" }]);
  let snapshot;
  try {
    await withCaptureState(context(lockDir), async ({ snapshot: captured, writeProgress }) => {
      snapshot = captured;
      await writeProgress(FILE_A, { position_ms: 900_000, duration_ms: 6_742_000, completed: false });
      await writeProgress(FILE_B, { position_ms: 500, duration_ms: 1000, completed: false });
    });
    assert.match(snapshot.hash, /^[0-9a-f]{64}$/);
    assert.deepEqual(api.rows.get(FILE_A), { media_file_id: FILE_A, position_ms: 15_098, duration_ms: 6_742_000, completed: false, state: "part_watched" });
    assert.deepEqual(api.rows.get(FILE_B), { media_file_id: FILE_B, position_ms: 0, duration_ms: 1000, completed: false, state: "unseen" });
    let persistenceAttempts = 0;
    const again = await captureCanonicalState({ ...context(lockDir), persistSecrets() { persistenceAttempts++; } });
    const stable = await captureCanonicalState({ ...context(lockDir) });
    assert.equal(again.hash, stable.hash);
    assert.ok(again.preferences.player.preferred_audio_language);
    assert.equal(persistenceAttempts, 0);
    const invalid = { ...again, hash: "0".repeat(64) };
    await assert.rejects(withCanonicalState({ ...context(lockDir), state: invalid }, async () => {}), /canonical state does not match/);
  } finally {}
});

test("expired capture credentials re-login and the snapshot is durable before the callback", async () => {
  const lockDir = await scratch();
  const api = mockApi([{ media_file_id: FILE_A, position_ms: 700, duration_ms: 2000, state: "part_watched" }], { expireFirstToken: true });
  let snapshotPath;
  await withCaptureState(context(lockDir), async ({ writeProgress }) => {
    const key = createHash("sha256").update(`${serverUrl}\nfixture-user`).digest("hex").slice(0, 24);
    snapshotPath = join(lockDir, key, "snapshot.json");
    const saved = JSON.parse(await readFile(snapshotPath, "utf8"));
    assert.equal(saved.files[FILE_A].position_ms, 700);
    assert.ok(saved.initiallyPresent.includes(FILE_A));
    await writeProgress(FILE_A, { position_ms: 1_200, duration_ms: 2000, completed: false });
    api.expireCurrentToken();
  });
  assert.equal(api.loginCount, 2, "restore must log in after the callback expires the original token");
  assert.equal(api.rows.get(FILE_A).position_ms, 700);
  await assert.rejects(readFile(snapshotPath), { code: "ENOENT" });
});

test("a stale same-host lock owner PID is reclaimed", async () => {
  const lockDir = await scratch();
  const key = createHash("sha256").update(`${serverUrl}\nfixture-user`).digest("hex").slice(0, 24);
  const staleDir = join(lockDir, key);
  await mkdir(staleDir);
  await writeFile(join(staleDir, "owner.json"), JSON.stringify({ pid: 99_999_999, host: hostname() }));
  mockApi();
  await withCaptureState({ ...context(lockDir), env: { ...context(lockDir).env, PARITY_LOCK_TIMEOUT_MS: "50" } }, async () => {});
});

test("a stale legacy unknown-host lock owner PID is reclaimed", async () => {
  const lockDir = await scratch();
  const key = createHash("sha256").update(`${serverUrl}\nfixture-user`).digest("hex").slice(0, 24);
  const staleDir = join(lockDir, key);
  await mkdir(staleDir);
  await writeFile(join(staleDir, "owner.json"), JSON.stringify({ pid: 99_999_999, host: "unknown" }));
  mockApi();
  await withCaptureState({ ...context(lockDir), env: { ...context(lockDir).env, PARITY_LOCK_TIMEOUT_MS: "50" } }, async () => {});
});

test("a stale lock with a snapshot is retained for recovery", async () => {
  const lockDir = await scratch();
  const key = createHash("sha256").update(`${serverUrl}\nfixture-user`).digest("hex").slice(0, 24);
  const staleDir = join(lockDir, key);
  await mkdir(staleDir);
  await writeFile(join(staleDir, "owner.json"), JSON.stringify({ pid: 99_999_999, host: hostname() }));
  await writeFile(join(staleDir, "snapshot.json"), JSON.stringify({ files: {}, preferences: {} }));
  mockApi();
  await assert.rejects(withCaptureState({ ...context(lockDir), env: { ...context(lockDir).env, PARITY_LOCK_TIMEOUT_MS: "50" } }, async () => {}), /has a recovery snapshot/);
  assert.equal(JSON.parse(await readFile(join(staleDir, "snapshot.json"), "utf8")).files.constructor, Object);
});

test("concurrent callers reclaim a stale lock without stealing the new owner", async () => {
  const lockDir = await scratch();
  const key = createHash("sha256").update(`${serverUrl}\nfixture-user`).digest("hex").slice(0, 24);
  const staleDir = join(lockDir, key);
  const owner = { pid: 99_999_999, host: hostname() };
  await mkdir(staleDir);
  await writeFile(join(staleDir, "owner.json"), JSON.stringify(owner));
  mockApi();
  let release;
  const hold = new Promise((resolve) => { release = resolve; });
  let entered = 0;
  let active = 0;
  let maxActive = 0;
  const enter = async () => {
    entered++;
    active++;
    maxActive = Math.max(maxActive, active);
    try {
      if (entered === 1) await hold;
    } finally { active--; }
  };
  const callers = [withCaptureState(context(lockDir), enter), withCaptureState(context(lockDir), enter)];
  let entryTimeout;
  try {
    await Promise.race([
      (async () => { while (entered === 0) await new Promise((resolve) => setTimeout(resolve, 1)); })(),
      new Promise((_, reject) => { entryTimeout = setTimeout(() => reject(new Error("first callback did not enter within 5 seconds")), 5000); }),
    ]);
    clearTimeout(entryTimeout);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(entered, 1, "the second callback must remain blocked while the first owns the lock");
  } finally {
    release();
  }
  await Promise.all(callers);
  assert.equal(entered, 2);
  assert.equal(maxActive, 1);
  const tombstone = `${staleDir}.stale-${createHash("sha256").update(JSON.stringify(owner)).digest("hex").slice(0, 24)}`;
  assert.equal(JSON.parse(await readFile(join(tombstone, "owner.json"), "utf8")).pid, owner.pid);
});

test("termination signals restore state, stop callback work, and release the account lock", async () => {
  const lockDir = await scratch();
  const signals = ["SIGINT", "SIGTERM"];
  for (const signal of signals) {
    const childSource = `
      import { withCaptureState } from ${JSON.stringify(new URL("./capture-state.mjs", import.meta.url).href)};
      const file = "12345678-1234-4234-8234-1234567890ab";
      let position = 5;
      let stopped = false;
      let interrupted = false;
      let lateCompletion = false;
      let resetCalls = 0;
      let resolvePending;
      globalThis.fetch = async (url, options = {}) => {
        const path = new URL(url).pathname;
        if (path.endsWith("/auth/login")) return new Response(JSON.stringify({ access_token: "child-token" }));
        if (path.endsWith("/playback/progress")) return new Response(JSON.stringify([{ media_file_id: file, position_ms: position, duration_ms: 1000, state: position ? "part_watched" : "unseen" }]));
        if (path.endsWith("/" + ["home", "rails", "preferences"].join("/"))) return new Response(JSON.stringify({ rails: [] }));
        if (path.endsWith("/player-preferences")) return new Response(JSON.stringify({ preferred_audio_language: "en" }));
        if (path.endsWith("/playback/" + file + "/progress") && options.method === "PUT") { if (JSON.parse(options.body).position_ms === 5 && (!stopped || !lateCompletion)) throw new Error("restore began before delayed download completed"); position = JSON.parse(options.body).position_ms; return new Response(JSON.stringify({})); }
        return new Response(JSON.stringify({}));
      };
      const keepAlive = setInterval(() => {}, 1000);
      try {
        await withCaptureState({ client: "web-capture-10620", files: [file], env: { PLAYARR_SERVER_URL: "https://example.invalid", PARITY_LOCK_DIR: process.env.LOCK_DIR }, secrets: { PLAYARR_PARITY_WEB_CAPTURE_10620_USERNAME: "fixture-user", PLAYARR_PARITY_WEB_CAPTURE_10620_PASSWORD: "fixture-pass" }, persistSecrets() {} }, async ({ writeProgress, registerInterruptCleanup }) => {
          registerInterruptCleanup(async () => {
            await new Promise((resolve) => setTimeout(resolve, 50));
            stopped = true;
            interrupted = true;
            resolvePending();
          });
          await writeProgress(file, { position_ms: 999, duration_ms: 1000, completed: false });
          console.log("READY");
          await new Promise((resolve) => { resolvePending = resolve; });
          await new Promise((resolve) => setTimeout(resolve, 50));
          lateCompletion = true;
          await Promise.resolve(writeProgress(file, { position_ms: 777, duration_ms: 1000, completed: false })).then(() => { throw new Error("late download progress escaped signal guard"); }, (error) => { if (!/interrupted/.test(error.message)) throw error; console.log("BLOCKED"); });
          if (!interrupted) {
            resetCalls++;
            await Promise.resolve(writeProgress(file, { position_ms: 777, duration_ms: 1000, completed: false })).then(() => { throw new Error("callback request escaped signal guard"); }, (error) => { if (!/interrupted/.test(error.message)) throw error; console.log("BLOCKED"); });
          }
        });
      } catch {}
      clearInterval(keepAlive);
      process.stdout.write("RESTORED:" + position + ":RESET:" + resetCalls);
    `;
    const child = spawn(process.execPath, ["--input-type=module", "-e", childSource], { env: { ...process.env, LOCK_DIR: lockDir }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("signal fixture did not become ready")), 5_000);
      child.stdout.on("data", (chunk) => { if ((stdout + chunk).includes("READY")) { clearTimeout(timeout); resolve(); } });
      child.once("error", reject);
    });
    child.kill(signal);
    const [code, receivedSignal] = await once(child, "close");
    assert.match(stdout, /RESTORED:5:RESET:0/, `child exited ${code}/${receivedSignal}; stderr: ${stderr}`);
    assert.match(stdout, /BLOCKED/, `post-signal callback request was not rejected: ${stdout}`);
    assert.equal(code, signal === "SIGINT" ? 130 : 143, `unexpected subprocess exit ${code}/${receivedSignal}`);
    const key = createHash("sha256").update(`${serverUrl}\nfixture-user`).digest("hex").slice(0, 24);
    await assert.rejects(readFile(join(lockDir, key, "owner.json")), { code: "ENOENT" });
  }
});

test("restore skips unchanged progress and writes only rows changed by the callback", async () => {
  const lockDir = await scratch();
  const api = mockApi([
    { media_file_id: FILE_A, position_ms: 15_098, duration_ms: 6_742_000, state: "part_watched" },
    { media_file_id: FILE_B, position_ms: 4_000, duration_ms: 6_742_000, state: "part_watched" },
  ]);
  await withCaptureState({ ...context(lockDir), files: [FILE_A, FILE_B] }, async ({ writeProgress }) => {
    await writeProgress(FILE_B, { position_ms: 4_001, duration_ms: 6_742_000, completed: false });
  });
  const writes = api.calls.filter(({ path, method }) => method === "PUT" && /\/playback\/[0-9a-f-]+\/progress$/i.test(path));
  assert.deepEqual(writes.map(({ path }) => path), [`/api/v1/playback/${FILE_B}/progress`, `/api/v1/playback/${FILE_B}/progress`]);
  assert.ok(!writes.some(({ path }) => path === `/api/v1/playback/${FILE_A}/progress`));
  assert.deepEqual(api.rows.get(FILE_A), { media_file_id: FILE_A, position_ms: 15_098, duration_ms: 6_742_000, state: "part_watched" });
  assert.equal(api.rows.get(FILE_B).position_ms, 4_000);
});

test("callback and restore failures retain both causes, and canonical restore keeps tokens in memory", async () => {
  const lockDir = await scratch();
  const api = mockApi([{ media_file_id: FILE_A, position_ms: 700, duration_ms: 2000, state: "part_watched" }]);
  const expected = new Error("capture callback failed");
  await assert.rejects(withCaptureState(context(lockDir), async () => {
    api.failNextPreferenceRestore();
    throw expected;
  }), (error) => {
    assert.ok(error instanceof AggregateError);
    assert.ok(error.errors.includes(expected));
    assert.ok(error.errors.some((cause) => /failed to restore/.test(cause.message)));
    return true;
  });
  const key = createHash("sha256").update(`${serverUrl}\nfixture-user`).digest("hex").slice(0, 24);
  assert.equal(JSON.parse(await readFile(join(lockDir, key, "snapshot.json"), "utf8")).files[FILE_A].position_ms, 700);

  const canonicalLock = await scratch();
  mockApi([{ media_file_id: FILE_A, position_ms: 700, duration_ms: 2000, state: "part_watched" }]);
  const canonical = await captureCanonicalState(context(canonicalLock));
  let persistenceAttempts = 0;
  await withCanonicalState({ ...context(canonicalLock), state: canonical, persistSecrets() { persistenceAttempts++; } }, async ({ snapshot }) => {
    assert.equal(snapshot.hash, canonical.hash);
  });
  assert.equal(persistenceAttempts, 0);
});

test("resume choice reset clears series only and propagates non-404 plan failures", async () => {
  const lockDir = await scratch();
  const api = mockApi([
    { media_file_id: FILE_A, work_id: SERIES, position_ms: 10, duration_ms: 100, state: "part_watched" },
    { media_file_id: FILE_B, work_id: MOVIE, position_ms: 20, duration_ms: 100, state: "part_watched" },
    { media_file_id: "55555555-5555-4555-8555-555555555555", work_id: EPISODE, position_ms: 30, duration_ms: 100, state: "part_watched" },
  ]);
  await withCaptureState(context(lockDir), async ({ clearResumeChoices }) => {
    assert.equal(await clearResumeChoices(), 1);
  });
  assert.ok(api.calls.some(({ path, method }) => path === `/api/v1/catalog/${SERIES}/resume-plan/choices` && method === "DELETE"));
  assert.ok(!api.calls.some(({ path, method }) => method === "DELETE" && (path.includes(MOVIE) || path.includes(EPISODE))));

  const failingLock = await scratch();
  mockApi([{ media_file_id: FILE_A, work_id: BROKEN, position_ms: 10, duration_ms: 100, state: "part_watched" }]);
  await assert.rejects(withCaptureState(context(failingLock), async ({ clearResumeChoices }) => clearResumeChoices()), /returned 500/);
});

test("restore runs after callback failure and account lock serialises concurrent callbacks", async () => {
  const lockDir = await scratch();
  mockApi([{ media_file_id: FILE_A, position_ms: 700, duration_ms: 2000, state: "part_watched" }]);
  let release;
  const entered = new Promise((resolve) => { release = resolve; });
  let started;
  const startedFirst = new Promise((resolve) => { started = resolve; });
  try {
    const first = withCaptureState(context(lockDir), async ({ writeProgress }) => {
      started();
      await writeProgress(FILE_A, { position_ms: 1500, duration_ms: 2000, completed: false });
      await entered;
      throw new Error("fixture callback failure");
    });
    await startedFirst;
    let secondEntered = false;
    const second = withCaptureState(context(lockDir), async () => { secondEntered = true; });
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(secondEntered, false);
    release();
    await assert.rejects(first, /fixture callback failure/);
    await second;
    assert.equal(secondEntered, true);
  } finally {}
});

test("lock directory must be explicit", async () => {
  mockApi();
  await assert.rejects(withCaptureState({ ...context(undefined), env: { PLAYARR_SERVER_URL: serverUrl } }, async () => {}), /PARITY_LOCK_DIR is required/);
});

test("a lock directory removed during the run does not fail a restored capture", async () => {
  const lockDir = await scratch();
  const api = mockApi([{ media_file_id: FILE_A, position_ms: 700, duration_ms: 2000, state: "part_watched" }]);
  const key = createHash("sha256").update(`${serverUrl}\nfixture-user`).digest("hex").slice(0, 24);
  await withCaptureState(context(lockDir), async ({ writeProgress }) => {
    await writeProgress(FILE_A, { position_ms: 1_200, duration_ms: 2000, completed: false });
    await rm(join(lockDir, key), { recursive: true, force: true });
  });
  assert.equal(api.rows.get(FILE_A).position_ms, 700);
});
