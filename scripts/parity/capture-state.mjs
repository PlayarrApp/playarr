import { createHash, randomUUID } from "node:crypto";
import { mkdir, rm, rmdir, writeFile, readFile, unlink, rename } from "node:fs/promises";
import { hostname } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { clientSecretKeys, parityCredentials, readSecrets, storeSecrets } from "./dpad-account.mjs";

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HOME_RAILS_PREFERENCES = `/api/v1/${["home", "rails", "preferences"].join("/")}`;
const execFileAsync = promisify(execFile);
const slug = (value) => {
  const result = String(value ?? "").toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(result)) throw new Error("client must be a lowercase slug");
  return result;
};

function clientEnvironment(client, env, secrets) {
  const keys = clientSecretKeys(client);
  const dpadOptIn = env.PARITY_USE_DEVICE_TEST_DPAD === "1";
  const deviceGuard = env.PARITY_DEVICE_ACCOUNT_GUARD === "android";
  if (deviceGuard && !dpadOptIn) throw new Error("Android device account guard requires the explicit D-pad account alias");
  if (dpadOptIn && !deviceGuard) throw new Error("D-pad credentials require the Android device account guard");
  const credentials = dpadOptIn
    ? { username: secrets.PLAYARR_DEVICE_TEST_DPAD_USERNAME ?? env.PLAYARR_DEVICE_TEST_DPAD_USERNAME, password: secrets.PLAYARR_DEVICE_TEST_DPAD_PASSWORD ?? env.PLAYARR_DEVICE_TEST_DPAD_PASSWORD }
    : parityCredentials({ ...env, PARITY_CLIENT: client }, secrets);
  if (!credentials.username || !credentials.password) throw new Error("missing explicitly selected parity account credentials");
  const serverUrl = env.PLAYARR_SERVER_URL ?? env.PLAYARR_DEVICE_TEST_SERVER_URL ?? secrets.PLAYARR_DEVICE_TEST_SERVER_URL;
  if (!serverUrl) throw new Error("PLAYARR_SERVER_URL or PLAYARR_DEVICE_TEST_SERVER_URL is required");
  return { ...env, PARITY_CLIENT: client, PARITY_ACCOUNT: client, PLAYARR_SERVER_URL: serverUrl.replace(/\/$/, ""), PLAYARR_USERNAME: credentials.username, PLAYARR_PASSWORD: credentials.password, PARITY_USERNAME_KEY: dpadOptIn ? "PLAYARR_DEVICE_TEST_DPAD_USERNAME" : keys.username, PARITY_PASSWORD_KEY: dpadOptIn ? "PLAYARR_DEVICE_TEST_DPAD_PASSWORD" : keys.password };
}

function readVarint(bytes, state) {
  let value = 0n, shift = 0n;
  while (state.offset < bytes.length && shift < 70n) {
    const byte = bytes[state.offset++];
    value |= BigInt(byte & 0x7f) << shift;
    if (!(byte & 0x80)) return Number(value);
    shift += 7n;
  }
  throw new Error("Android device session data is invalid");
}

function fields(bytes) {
  const result = [];
  const state = { offset: 0 };
  while (state.offset < bytes.length) {
    const tag = readVarint(bytes, state), number = tag >>> 3, wire = tag & 7;
    if (!number) throw new Error("Android device session data is invalid");
    if (wire === 0) result.push([number, wire, readVarint(bytes, state)]);
    else if (wire === 2) {
      const length = readVarint(bytes, state), end = state.offset + length;
      if (end > bytes.length) throw new Error("Android device session data is invalid");
      result.push([number, wire, bytes.subarray(state.offset, end)]);
      state.offset = end;
    } else if (wire === 1 || wire === 5) state.offset += wire === 1 ? 8 : 4;
    else throw new Error("Android device session data is invalid");
    if (state.offset > bytes.length) throw new Error("Android device session data is invalid");
  }
  return result;
}

/** Decode only the string entries needed to identify the Android app's live DataStore session. */
export function parseAndroidDeviceSession(hex) {
  if (typeof hex !== "string" || !/^(?:\s*[0-9a-f]{2})+\s*$/i.test(hex)) throw new Error("Android device session unavailable");
  const bytes = Buffer.from(hex.replace(/\s/g, ""), "hex"), values = {};
  for (const [, wire, entry] of fields(bytes)) {
    if (wire !== 2) continue;
    const entryFields = fields(entry);
    const key = entryFields.find(([n, w]) => n === 1 && w === 2)?.[2]?.toString("utf8");
    const valueFields = entryFields.find(([n, w]) => n === 2 && w === 2)?.[2];
    const value = valueFields && fields(valueFields).find(([n, w]) => n === 5 && w === 2)?.[2]?.toString("utf8");
    if (key && value) values[key] = value;
  }
  const session = {
    accessToken: values.playarr_access_token,
    serverUrl: values.playarr_current_server_url ?? values.playarr_base_url,
    userId: values.playarr_user_id,
  };
  if (!session.accessToken || !session.serverUrl || !session.userId) throw new Error("Android device session unavailable");
  return session;
}

export async function assertAndroidDeviceAccount({ session, expectedUsername, expectedServerUrl, fetchImpl = fetch }) {
  const canonical = (value) => {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("invalid server");
    return url.toString().replace(/\/$/, "");
  };
  let serverUrl;
  try { serverUrl = canonical(session?.serverUrl); }
  catch { throw new Error("Android device account server is invalid"); }
  if (serverUrl !== canonical(expectedServerUrl)) throw new Error("Android device account server does not match the selected capture server");
  if (typeof session?.accessToken !== "string" || !session.accessToken || !session.userId) throw new Error("Android device account does not match the selected approved account");
  let response, profiles;
  try {
    response = await fetchImpl(`${serverUrl}/api/v1/users/profiles`, { headers: { authorization: `Bearer ${session.accessToken}` }, cache: "no-store", signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error();
    profiles = await response.json();
  } catch { throw new Error("Android device account identity check failed"); }
  const current = Array.isArray(profiles) ? profiles.filter((profile) => profile?.is_current === true) : [];
  if (current.length !== 1 || current[0]?.username !== expectedUsername || current[0]?.id !== session.userId) throw new Error("Android device account does not match the selected approved account");
  return true;
}

export async function readAndroidDeviceSession(env = process.env, persistToken = null) {
  const adb = env.ANDROID_HOME ? `${env.ANDROID_HOME}/platform-tools/adb` : "adb";
  const pkg = env.PARITY_PACKAGE ?? "io.playarr.mobile";
  try {
    const { stdout } = await execFileAsync(adb, ["exec-out", "run-as", pkg, "cat", "files/datastore/playarr_client_prefs.preferences_pb"], { env, timeout: 30_000, maxBuffer: 1 << 20, encoding: "buffer" });
    const session = parseAndroidDeviceSession(stdout.toString("hex"));
    // The observed-token record is a convenience: ~/.secrets is shared by every worker, so a busy write lock must not fail the guard.
    try { await (persistToken ?? ((token) => storeSecrets({ PLAYARR_PARITY_ANDROID_OBSERVED_ACCESS_TOKEN: token })))(session.accessToken); } catch { /* keep the session */ }
    return session;
  } catch { throw new Error("Android device session unavailable for account guard"); }
}

export async function guardAndroidDeviceAccount(env = process.env) {
  if (env.PARITY_DEVICE_ACCOUNT_GUARD !== "android") return;
  if (env.PARITY_USE_DEVICE_TEST_DPAD !== "1") throw new Error("Android device account guard requires the explicit D-pad account alias");
  const session = await readAndroidDeviceSession(env);
  await assertAndroidDeviceAccount({ session, expectedUsername: env.PLAYARR_USERNAME, expectedServerUrl: env.PLAYARR_SERVER_URL });
}

/** Resolve one explicitly selected isolated account without falling back to the shared device-test user. */
export function resolveCaptureEnvironment(client, env = process.env, secrets = readSecrets()) {
  return clientEnvironment(client, env, secrets);
}

async function acquireLock(client, env) {
  const root = env.PARITY_LOCK_DIR;
  if (!root) throw new Error("PARITY_LOCK_DIR is required and must point to an approved local scratch directory");
  const accountKey = createHash("sha256").update(`${env.PLAYARR_SERVER_URL}\n${env.PLAYARR_USERNAME}`).digest("hex").slice(0, 24);
  const dir = join(root, accountKey);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const timeoutMs = Number(env.PARITY_LOCK_TIMEOUT_MS ?? 120_000);
  const started = Date.now();
  while (true) {
    try {
      await mkdir(dir, { mode: 0o700 });
      try { await writeFile(join(dir, "owner.json"), JSON.stringify({ client, pid: process.pid, host: hostname(), acquired_at: new Date().toISOString() }), { mode: 0o600, flag: "wx" }); }
      catch (error) { await rmdir(dir).catch(() => {}); throw error; }
      return async () => { await rm(join(dir, "owner.json"), { force: true }); await rmdir(dir); };
    } catch (error) {
      if (error.code !== "EEXIST" && error.code !== "ENOTEMPTY") throw error;
      let recoverySnapshot = false;
      try {
        const ownerPath = join(dir, "owner.json");
        const ownerBytes = await readFile(ownerPath);
        const owner = JSON.parse(ownerBytes.toString("utf8"));
        if ((owner.host === hostname() || owner.host === "unknown") && Number.isInteger(owner.pid) && owner.pid > 1) {
          try { process.kill(owner.pid, 0); }
          catch (probeError) {
            if (probeError.code === "ESRCH") {
              const currentBytes = await readFile(ownerPath);
              const current = JSON.parse(currentBytes.toString("utf8"));
              if (current.pid === owner.pid && currentBytes.equals(ownerBytes)) {
                try { await readFile(join(dir, "snapshot.json"), "utf8"); recoverySnapshot = true; }
                catch (snapshotError) {
                  if (snapshotError.code !== "ENOENT") throw snapshotError;
                  const ownerHash = createHash("sha256").update(ownerBytes).digest("hex").slice(0, 24);
                  // Keep the non-empty tombstone: competing stale-lock reclaimers then cannot rename a new owner's directory over it.
                  const quarantine = `${dir}.stale-${ownerHash}`;
                  await rename(dir, quarantine);
                  continue;
                }
              }
            }
          }
        }
      } catch (inspectError) {
        if (recoverySnapshot) throw new Error(`stale parity lock for client ${client} has a recovery snapshot at ${join(dir, "snapshot.json")}; restore it before removing the lock`);
      }
      if (recoverySnapshot) throw new Error(`stale parity lock for client ${client} has a recovery snapshot at ${join(dir, "snapshot.json")}; restore it before removing the lock`);
      if (Date.now() - started >= timeoutMs) throw new Error(`timed out waiting for parity account lock for client ${client}; inspect ${dir} before removing it`);
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
}

async function requestJson(env, token, path, options = {}) {
  const response = await fetch(`${env.PLAYARR_SERVER_URL}${path}`, {
    ...options,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...options.headers },
  });
  if (!response.ok) {
    const error = new Error(`capture state ${options.method ?? "GET"} ${path} returned ${response.status}`);
    error.status = response.status;
    throw error;
  }
  if (response.status === 204) return null;
  return response.json();
}

function authenticatedRequest(env, getToken, refreshToken) {
  return async (path, options = {}) => {
    try { return await requestJson(env, getToken(), path, options); }
    catch (error) {
      if (error.status !== 401) throw error;
      await refreshToken();
      return requestJson(env, getToken(), path, options);
    }
  };
}

async function login(env) {
  const result = await requestJson(env, null, "/api/v1/auth/login", { method: "POST", body: JSON.stringify({ client_platform: "web", client_version: "parity", device_id: randomUUID(), device_name: `parity-${env.PARITY_CLIENT}`, username: env.PLAYARR_USERNAME, password: env.PLAYARR_PASSWORD }) });
  if (!result?.access_token) throw new Error("capture state login returned no access token");
  if (env.PARITY_DEVICE_ACCOUNT_GUARD === "android" && env.PARITY_USE_DEVICE_TEST_DPAD === "1") {
    const values = { PLAYARR_DEVICE_TEST_DPAD_PARITY_ACCESS_TOKEN: result.access_token };
    if (result.refresh_token) values.PLAYARR_DEVICE_TEST_DPAD_PARITY_REFRESH_TOKEN = result.refresh_token;
    try { storeSecrets(values); }
    catch { throw new Error("Android guarded parity login tokens could not be stored securely"); }
  }
  return result.access_token;
}

function progressValue(row) {
  return { position_ms: Number(row.position_ms ?? 0), duration_ms: Number(row.duration_ms ?? 0), completed: row.state === "watched" || row.completed === true };
}

function sameProgress(left, right) {
  return left.position_ms === right.position_ms && left.duration_ms === right.duration_ms && left.completed === right.completed;
}

function hashState(files, preferences) {
  const orderedFiles = Object.fromEntries(Object.keys(files).sort().map((file) => [file, files[file]]));
  return createHash("sha256").update(JSON.stringify({ files: orderedFiles, preferences })).digest("hex");
}

async function readPreferences(env, token, request = (path, options) => requestJson(env, token, path, options)) {
  const [rails, player] = await Promise.all([
    request(HOME_RAILS_PREFERENCES),
    request("/api/v1/users/me/player-preferences"),
  ]);
  return { rails, player };
}

async function restorePreferences(env, token, preferences, request = (path, options) => requestJson(env, token, path, options)) {
  const rails = preferences.rails?.rails ?? [];
  await Promise.all([
    request(HOME_RAILS_PREFERENCES, { method: "PUT", body: JSON.stringify({ order: rails.map((rail) => rail.id), hidden: rails.filter((rail) => rail.hidden).map((rail) => rail.id) }) }),
    request("/api/v1/users/me/player-preferences", { method: "PATCH", body: JSON.stringify(preferences.player) }),
  ]);
}

/** Capture and restore only the listed media files while serialising all runs using this account. */
export async function withCaptureState({ client, files, env = process.env, secrets = readSecrets() }, fn) {
  const clientName = slug(client ?? env.PARITY_CLIENT);
  if (!Array.isArray(files) || files.some((id) => !ID.test(id))) throw new Error("files must be an array of media file IDs");
  if (typeof fn !== "function") throw new Error("withCaptureState requires a callback");
  const uniqueFiles = [...new Set(files)];
  const runEnv = clientEnvironment(clientName, env, secrets);
  await guardAndroidDeviceAccount(runEnv);
  const unlock = await acquireLock(clientName, runEnv);
  let preserveLock = false;
  try {
    let token = await login(runEnv);
    const refreshToken = async () => { token = await login(runEnv); };
    const apiRequest = authenticatedRequest(runEnv, () => token, refreshToken);
    const listed = await apiRequest("/api/v1/playback/progress");
    if (!Array.isArray(listed)) throw new Error("capture state progress list was not an array");
    const allFiles = [...new Set([...listed.map((row) => row.media_file_id).filter(Boolean), ...uniqueFiles])].sort();
    const initial = new Map(listed.filter((row) => row.media_file_id).map((row) => [row.media_file_id, progressValue(row)]));
    const filesSnapshot = {};
    for (const file of allFiles) filesSnapshot[file] = initial.get(file) ?? progressValue(await apiRequest(`/api/v1/playback/${file}/progress`));
    const preferences = await readPreferences(runEnv, token, apiRequest);
    const initiallyPresent = listed.map((row) => row.media_file_id).filter(Boolean);
    const snapshot = { files: filesSnapshot, preferences, hash: hashState(filesSnapshot, preferences) };
    const lockDir = join(runEnv.PARITY_LOCK_DIR, createHash("sha256").update(`${runEnv.PLAYARR_SERVER_URL}\n${runEnv.PLAYARR_USERNAME}`).digest("hex").slice(0, 24));
    const snapshotPath = join(lockDir, "snapshot.json");
    await writeFile(snapshotPath, `${JSON.stringify({ ...snapshot, initiallyPresent }, null, 2)}\n`, { mode: 0o600 });
    let restored = false;
    let restoring;
    let interrupted = false;
    let signalResolve;
    const signalPromise = new Promise((resolve) => { signalResolve = resolve; });
    const interruptCleanup = new Set();
    let inFlight = 0;
    let drainInFlight;
    const registerInterruptCleanup = (cleanup) => { if (typeof cleanup !== "function") throw new Error("interrupt cleanup must be a function"); interruptCleanup.add(cleanup); };
    let handlingSignal;
    let interruptPromise;
    const onSignal = (signal) => {
      handlingSignal ??= (async () => {
      interrupted = signal;
      process.exitCode = interrupted === "SIGINT" ? 130 : 143;
      await Promise.allSettled([...interruptCleanup].map((cleanup) => cleanup()));
      if (inFlight) await new Promise((resolve) => { drainInFlight = resolve; });
      signalResolve(interrupted);
      })();
      interruptPromise = handlingSignal;
      return handlingSignal;
    };
    const onSigint = () => { void onSignal("SIGINT"); };
    const onSigterm = () => { void onSignal("SIGTERM"); };
    process.once("SIGINT", onSigint);
    process.once("SIGTERM", onSigterm);
    const request = authenticatedRequest(runEnv, () => token, refreshToken);
    const guardedRequest = async (path, options = {}) => {
      if (interrupted) throw new Error("capture interrupted by termination signal");
      inFlight++;
      try { return await request(path, options); }
      finally { inFlight--; if (!inFlight && drainInFlight) { drainInFlight(); drainInFlight = undefined; } }
    };
    const restore = async () => {
      if (restored) return;
      if (restoring) return restoring;
      restoring = (async () => {
      await refreshToken();
      const failures = [];
      let after = [];
      try {
        after = await request("/api/v1/playback/progress");
        if (!Array.isArray(after)) throw new Error("capture state progress list was not an array during restore");
      } catch (error) { failures.push(error); }
      const restoreFiles = [...new Set([...allFiles, ...after.map((row) => row.media_file_id).filter(Boolean)])].sort();
      const current = new Map(after.filter((row) => row.media_file_id).map((row) => [row.media_file_id, progressValue(row)]));
      const initiallyPresentSet = new Set(initiallyPresent);
      for (const file of restoreFiles) {
        const value = filesSnapshot[file] ?? { position_ms: 0, duration_ms: Number(after.find((row) => row.media_file_id === file)?.duration_ms ?? 0), completed: false };
        const currentValue = current.get(file);
        if (currentValue && sameProgress(currentValue, value)) continue;
        if (!currentValue && !initiallyPresentSet.has(file)) continue;
        try { await request(`/api/v1/playback/${file}/progress`, { method: "PUT", body: JSON.stringify(value) }); }
        catch (error) { failures.push(error); }
      }
      try { await restorePreferences(runEnv, token, preferences, request); }
      catch (error) { failures.push(error); }
      if (failures.length) throw new AggregateError(failures, `failed to restore ${failures.length} capture state components`);
      restored = true;
      await unlink(snapshotPath).catch(() => {});
      })();
      try { await restoring; }
      finally { restoring = undefined; }
    };
    let result, callbackError, restoreError;
    let callback;
    const writeProgress = (file, value) => guardedRequest(`/api/v1/playback/${file}/progress`, { method: "PUT", body: JSON.stringify(value) });
    const snapshotNow = async () => {
      const rows = await guardedRequest("/api/v1/playback/progress");
      if (!Array.isArray(rows)) throw new Error("capture state progress list was not an array while refreshing snapshot");
      const current = new Map(rows.filter((row) => row.media_file_id).map((row) => [row.media_file_id, progressValue(row)]));
      const files = {};
      for (const file of [...new Set([...rows.map((row) => row.media_file_id).filter(Boolean), ...uniqueFiles])].sort()) {
        files[file] = current.get(file) ?? progressValue(await guardedRequest(`/api/v1/playback/${file}/progress`));
      }
      const currentPreferences = await readPreferences(runEnv, token, guardedRequest);
      return { files, preferences: currentPreferences, hash: hashState(files, currentPreferences) };
    };
    const clearResumeChoices = async () => {
      const rows = await guardedRequest("/api/v1/playback/progress");
      const works = [...new Set(rows.map((row) => row.work_id).filter(Boolean))].sort();
      const series = [];
      for (const work of works) {
        try { await guardedRequest(`/api/v1/catalog/${work}/resume-plan`); series.push(work); }
        catch (error) { if (error.status !== 404) throw error; }
      }
      for (const work of series) await guardedRequest(`/api/v1/catalog/${work}/resume-plan/choices`, { method: "DELETE" });
      return series.length;
    };
    const writePreferences = (value) => restorePreferences(runEnv, token, value, guardedRequest);
    try {
      callback = Promise.resolve().then(() => fn({ env: runEnv, account: clientName, snapshot: structuredClone(snapshot), snapshotNow, restore, writeProgress, writePreferences, clearResumeChoices, registerInterruptCleanup }));
      result = await Promise.race([callback, signalPromise.then((signal) => { throw new Error(`capture interrupted by ${signal}`); })]);
    }
    catch (error) { callbackError = error; }
    try {
      if (interruptPromise) await interruptPromise;
      if (interrupted && callback) await callback.catch(() => {});
      await restore();
    } catch (error) { restoreError = error; preserveLock = true; }
    finally { process.removeListener("SIGINT", onSigint); process.removeListener("SIGTERM", onSigterm); }
    if (callbackError && restoreError) throw new AggregateError([callbackError, restoreError], "capture failed and progress restoration also failed");
    if (callbackError) throw callbackError;
    if (restoreError) throw restoreError;
    return result;
  } finally {
    if (!preserveLock) await unlock();
  }
}

/** Save a reusable canonical snapshot for paired web/device runs. */
export async function captureCanonicalState({ client, files, env = process.env, secrets = readSecrets() }) {
  return withCaptureState({ client, files, env, secrets }, async ({ snapshot, env: runEnv }) => ({ client: runEnv.PARITY_CLIENT, files: snapshot.files, preferences: snapshot.preferences, hash: snapshot.hash }));
}

/** Apply a saved snapshot under the same account lock and restore it again after the callback. */
export async function withCanonicalState({ client, state, files = Object.keys(state?.files ?? {}), env = process.env, secrets = readSecrets() }, fn) {
  if (!state || state.client !== slug(client ?? env.PARITY_CLIENT) || !state.files || !state.preferences || Object.keys(state.files).some((file) => !ID.test(file)) || files.some((file) => !ID.test(file) || !state.files[file]) || state.hash !== hashState(state.files, state.preferences)) throw new Error("canonical state does not match the requested client, files, or hash");
  return withCaptureState({ client, files, env, secrets }, async ({ env: runEnv, restore, writeProgress, writePreferences }) => {
    for (const file of Object.keys(state.files)) await writeProgress(file, state.files[file]);
    await writePreferences(state.preferences);
    return fn({ env: runEnv, account: runEnv.PARITY_CLIENT, snapshot: structuredClone(state), restore });
  });
}
