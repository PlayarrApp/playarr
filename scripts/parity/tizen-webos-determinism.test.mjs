import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import vm from "node:vm";
import { createDriver } from "./drivers/tizen-webos.mjs";

const serverUrl = "https://server.example.invalid";
const bytes = Buffer.from("verified runtime bundle");
const digest = createHash("sha256").update(bytes).digest("hex");
const manifest = {
  schema: 1,
  sourceCommit: "a".repeat(40),
  packageTreeSha256: "b".repeat(64),
  runtimeEntry: { name: "assets/index-test.js", sha256: digest, observedLoadedInDevice: true },
};

async function makeDriver({ device = "webos", username = "fixture-device-user", loaded = true, staged = bytes, focused = true, routeReady = true, stableImages = true, fontsReady = true, fontsRejected = false, clockConsumed = true, routeChanges = false, cdpErrorMethod, cdpIdentityFailureOnReconnect } = {}) {
  const calls = [];
  let routeReads = 0;
  let socketCount = 0;
  class Socket {
    static CLOSING = 2;
    readyState = 1;
    constructor() { socketCount += 1; queueMicrotask(() => this.onopen?.()); }
    send(text) {
      const request = JSON.parse(text);
      calls.push(request);
      let result = {};
      if (request.method === "Runtime.evaluate") {
        const { expression } = request.params;
        let value;
        let pageException = false;
        // CDP evaluates the serialised helper body, so its identifier is not present.
        if (expression.includes('localStorage.getItem("playarr:session")')) value = { username, isCurrentCount: 1, serverUrl };
        else if (expression.includes("performance.getEntriesByType")) value = loaded ? { url: "https://stage.example.invalid/assets/index-test.js" } : null;
        else if (expression.includes("document.fonts.ready")) {
          if (fontsRejected) pageException = true;
          else value = fontsReady;
        }
        else if (expression.includes("location.hash.replace")) value = routeChanges && ++routeReads > 1 ? "/home" : "/settings";
        else if (expression.includes("visualNow")) value = {
          visualNow: clockConsumed ? Date.parse("2026-10-05T12:00:00Z") : Date.parse("2026-10-06T12:00:00Z"),
          wallNow: Date.parse("2026-10-07T12:00:00Z"),
        };
        else if (expression.includes("JSON.stringify([element.tagName")) value = focused ? '["BUTTON","Settings",1,2,3,4]' : "";
        else if (expression.includes("document.querySelector(q)")) value = routeReady;
        else if (expression.includes("activeAnimations")) value = stableImages ? '{"page":"settings","text":"ready"}' : null;
        else value = true;
        result = pageException ? { result: { exceptionDetails: { text: "mock font readiness rejection" } } } : { result: { result: { value } } };
      } else if (request.method === "Page.addScriptToEvaluateOnNewDocument") result = { result: { identifier: `hook-${calls.filter((call) => call.method === request.method).length}` } };
      else if (request.method === "Page.getFrameTree") result = { result: { frameTree: { frame: { id: "main-frame" } } } };
      else if (request.method === "Page.getResourceContent") result = { result: { content: bytes.toString("base64"), base64Encoded: true } };
      const response = { id: request.id, ...result };
      if (request.method === cdpErrorMethod) response.error = { message: "mock CDP protocol error" };
      const identityReconnect = request.method === "Runtime.evaluate" && request.params.expression.includes('localStorage.getItem("playarr:session")') && socketCount > 1;
      if (identityReconnect && cdpIdentityFailureOnReconnect === "protocol") response.error = { message: "mock CDP protocol error" };
      if (identityReconnect && cdpIdentityFailureOnReconnect === "exception") response.result = { exceptionDetails: { text: "sensitive mocked exception detail" } };
      queueMicrotask(() => this.onmessage?.({ data: JSON.stringify(response) }));
    }
    close() { this.readyState = 3; }
  }
  const env = {
    DEVICE: device, WEBOS_CDP: "9226", PARITY_CLIENT: "WEBOS", PLAYARR_DEVICE_TEST_USERNAME: "fixture-device-user",
    PARITY_WEBOS_BUILD_MANIFEST: "/stage/installed-package-manifest.json", PARITY_WEBOS_STAGE_ROOT: "/stage",
  };
  const driver = await createDriver({
    env,
    secrets: { PLAYARR_DEVICE_TEST_USERNAME: "fixture-device-user", PLAYARR_DEVICE_TEST_SERVER_URL: serverUrl, PLAYARR_PARITY_WEBOS_USERNAME: "unapproved-user" },
    fetchImpl: async () => ({ json: async () => [{ url: "webos-stage", webSocketDebuggerUrl: "ws://mock" }] }),
    WebSocketImpl: Socket,
    sleepImpl: async () => {},
    now: (() => { let tick = 0; return () => (tick += 1_000); })(),
    readFile: (path) => path.endsWith("installed-package-manifest.json") ? Buffer.from(JSON.stringify(manifest)) : staged,
  });
  return { driver, calls };
}

test("webOS deterministic capture validates arguments and the device-test identity", async () => {
  const { driver, calls } = await makeDriver();
  await assert.rejects(driver.setDeterministicCapture({ fixedNow: "not-a-date", disableAnimations: true }), /valid fixedNow/);
  await assert.rejects(driver.setDeterministicCapture({ fixedNow: "2026-10-05T12:00:00Z" }), /animation suppression/);
  assert.equal(calls.length, 0);

  const wrongAccount = await makeDriver({ username: "operator" });
  await assert.rejects(wrongAccount.driver.setDeterministicCapture({ fixedNow: "2026-10-05T12:00:00Z", disableAnimations: true }), /device-test account guard/);
  assert.equal(wrongAccount.calls.some((call) => call.method === "Page.addScriptToEvaluateOnNewDocument" && /parity-motion-off/.test(call.params.source)), false);
  const clientAlias = await makeDriver({ username: "unapproved-user" });
  await assert.rejects(clientAlias.driver.setDeterministicCapture({ fixedNow: "2026-10-05T12:00:00Z", disableAnimations: true }), /device-test account guard/);
});

test("webOS capture pins the visual clock, suppresses motion, and hashes Chromium's loaded runtime", async () => {
  const { driver, calls } = await makeDriver();
  await driver.setDeterministicCapture({ fixedNow: "2026-10-05T12:00:00Z", disableAnimations: true });
  const hook = calls.filter((call) => call.method === "Page.addScriptToEvaluateOnNewDocument").at(-1).params.source;
  assert.match(hook, /NativeDate\.now\(\)/);
  assert.match(hook, /animation:none!important/);
  assert.match(hook, /transition:none!important/);
  assert.match(hook, /restoreDeterministicCapture/);
  assertHookLifecycle(hook);
  await driver.waitReady({ screen: "settings", phase: "route" });
  assert.deepEqual(await driver.captureBuildIdentity(), {
    package: "webos-chromium", sha256: digest,
  });
  assert.ok(calls.some((call) => call.method === "Page.getResourceContent"));
  const pageEnableCount = calls.filter((call) => call.method === "Page.enable").length;
  await driver.start();
  assert.equal(calls.filter((call) => call.method === "Page.enable").length, pageEnableCount);
  await driver.stop();
  assert.ok(calls.some((call) => call.method === "Page.removeScriptToEvaluateOnNewDocument"));
  const restore = calls.findLast((call) => call.method === "Runtime.evaluate");
  assert.match(restore.params.expression, /restoreDeterministicCapture/);
});

function assertHookLifecycle(hook) {
  const styles = new Map(), listeners = new Map();
  const observers = [];
  class Element {
    animate() { return { finish() { this.finished = true; } }; }
  }
  const nativeAnimate = Element.prototype.animate;
  class MutationObserver {
    constructor(callback) { this.callback = callback; this.disconnected = false; observers.push(this); }
    observe() {}
    disconnect() { this.disconnected = true; }
  }
  const document = {
    head: { append(style) { style.isConnected = true; styles.set(style.id, style); } },
    createElement: () => ({ remove() { this.isConnected = false; styles.delete(this.id); } }),
    addEventListener(type, handler) { listeners.set(`${type}:${String(handler)}`, handler); },
    removeEventListener(type, handler) { listeners.delete(`${type}:${String(handler)}`); },
  };
  const sandbox = { document, Element, MutationObserver };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  const originalDate = vm.runInContext("Date", sandbox);
  new vm.Script(hook).runInContext(sandbox);
  assert.equal(new sandbox.Date().valueOf(), Date.parse("2026-10-05T12:00:00Z"));
  assert.notEqual(sandbox.Date.now(), Date.parse("2026-10-05T12:00:00Z"));
  assert.equal(styles.size, 1);
  assert.equal(listeners.size, 2);
  assert.equal(observers.filter((observer) => !observer.disconnected).length, 1);
  const animation = sandbox.Element.prototype.animate.call({});
  assert.equal(animation.finished, true);
  new vm.Script(hook).runInContext(sandbox);
  assert.equal(styles.size, 1);
  assert.equal(listeners.size, 2);
  assert.equal(observers.filter((observer) => !observer.disconnected).length, 1);
  const stop = hook.slice(0, hook.indexOf(";(function installVisualDate"));
  new vm.Script(stop).runInContext(sandbox);
  assert.equal(styles.size, 0);
  assert.equal(listeners.size, 0);
  assert.equal(observers.filter((observer) => !observer.disconnected).length, 0);
  assert.equal(sandbox.Date, originalDate);
  assert.equal(Element.prototype.animate, nativeAnimate);
}

test("webOS build identity fails closed for missing, changed, or mismatched runtime bytes", async () => {
  const missing = await makeDriver({ loaded: false });
  await assert.rejects(missing.driver.captureBuildIdentity(), /not present in Chromium resource timing/);
  const changed = await makeDriver({ staged: Buffer.from("different staged runtime") });
  await assert.rejects(changed.driver.captureBuildIdentity(), /hashes do not match/);
  const wrongAccount = await makeDriver({ username: "operator" });
  await assert.rejects(wrongAccount.driver.captureBuildIdentity(), /device-test account guard/);
});

test("webOS readiness fails when the current route has no ready view", async () => {
  const { driver } = await makeDriver({ routeReady: false });
  await assert.rejects(driver.waitReady({ screen: "settings", phase: "route" }), /route view did not become ready/);
});

test("webOS readiness waits for bounded document font readiness", async (t) => {
  const ready = await makeDriver();
  await ready.driver.waitReady({ screen: "settings", phase: "route" });
  const readinessCalls = ready.calls.filter((call) => call.method === "Runtime.evaluate").map((call) => call.params.expression);
  const fontGateIndex = readinessCalls.findIndex((expression) => expression.includes("document.fonts.ready") && expression.includes("5000"));
  const routeSettleIndex = readinessCalls.findIndex((expression) => expression.includes("document.querySelector(q)"));
  assert.ok(fontGateIndex >= 0 && routeSettleIndex > fontGateIndex, "fonts must load before route geometry settles");
  assert.ok(readinessCalls.some((expression) => expression.includes('document.fonts?.status === "loaded"')), "fonts must remain loaded after route settling");

  await t.test("fonts that time out fail closed", async () => {
    const timedOut = await makeDriver({ fontsReady: false });
    await assert.rejects(timedOut.driver.waitReady({ screen: "settings", phase: "route" }), /document fonts did not become ready/);
  });
  await t.test("rejected font readiness fails closed", async () => {
    const rejected = await makeDriver({ fontsRejected: true });
    await assert.rejects(rejected.driver.waitReady({ screen: "settings", phase: "route" }), /Runtime.evaluate raised a page exception/);
  });
});

test("webOS focus readiness fails without a stable focused element", async () => {
  const { driver } = await makeDriver({ focused: false });
  await assert.rejects(driver.waitReady({ screen: "settings", phase: "focus" }), /focus did not become stable/);
});

test("webOS readiness fails if the route changes while readiness is checked", async () => {
  const { driver } = await makeDriver({ routeChanges: true });
  await assert.rejects(driver.waitReady({ screen: "settings", phase: "route" }), /route changed while waiting/);
});

test("webOS readiness fails when the current document did not consume the fixed visual clock", async () => {
  const { driver } = await makeDriver({ clockConsumed: false });
  await driver.setDeterministicCapture({ fixedNow: "2026-10-05T12:00:00Z", disableAnimations: true });
  await assert.rejects(driver.waitReady({ screen: "settings", phase: "route" }), /visual clock was not consumed/);
  await driver.stop();
});

test("webOS capture readiness fails when visible content never settles", async () => {
  const { driver } = await makeDriver({ stableImages: false });
  await assert.rejects(driver.waitReady({ screen: "settings", phase: "capture" }), /visible images did not settle/);
});

test("webOS reconnect re-registers one owned hook and reports CDP protocol failures", async () => {
  const { driver, calls } = await makeDriver();
  await driver.setDeterministicCapture({ fixedNow: "2026-10-05T12:00:00Z", disableAnimations: true });
  await driver.route("/home");
  const deterministicHooks = calls.filter((call) => call.method === "Page.addScriptToEvaluateOnNewDocument" && call.params.source.includes("installVisualDate"));
  assert.equal(deterministicHooks.length, 2);
  assert.equal(deterministicHooks[0].params.source, deterministicHooks[1].params.source);
  await driver.stop();

  const protocolFailure = await makeDriver({ cdpErrorMethod: "Page.addScriptToEvaluateOnNewDocument" });
  await assert.rejects(protocolFailure.driver.setDeterministicCapture({ fixedNow: "2026-10-05T12:00:00Z", disableAnimations: true }), /CDP Page.addScriptToEvaluateOnNewDocument failed/);
  await protocolFailure.driver.stop();
});

test("webOS reconnect fails closed with sanitised CDP identity evaluation errors", async (t) => {
  await t.test("protocol error is not misreported as an account rejection", async () => {
    const { driver } = await makeDriver({ cdpIdentityFailureOnReconnect: "protocol" });
    await driver.setDeterministicCapture({ fixedNow: "2026-10-05T12:00:00Z", disableAnimations: true });
    await assert.rejects(driver.route("/home"), /CDP Runtime\.evaluate device-test identity failed/);
    await driver.stop();
  });
  await t.test("page exception is reported without exposing exception text", async () => {
    const { driver } = await makeDriver({ cdpIdentityFailureOnReconnect: "exception" });
    await driver.setDeterministicCapture({ fixedNow: "2026-10-05T12:00:00Z", disableAnimations: true });
    await assert.rejects(driver.route("/home"), (error) => {
      assert.match(error.message, /CDP Runtime\.evaluate device-test identity raised a page exception/);
      assert.doesNotMatch(error.message, /sensitive mocked exception detail/);
      return true;
    });
    await driver.stop();
  });
});

test("Tizen keeps deterministic capture unsupported without opening CDP", async () => {
  const { driver, calls } = await makeDriver({ device: "tizen" });
  await assert.rejects(driver.setDeterministicCapture({ fixedNow: "2026-10-05T12:00:00Z", disableAnimations: true }), /Tizen stable deterministic capture is unsupported/);
  await assert.rejects(driver.captureBuildIdentity(), /Tizen stable build identity is unsupported/);
  await assert.rejects(driver.waitReady({ screen: "home", phase: "route" }), /Tizen stable readiness is unsupported/);
  assert.equal(calls.length, 0);
});
