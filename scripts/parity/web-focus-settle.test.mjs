import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assertWebReady, clearSuccessfulBootstrapLoginErrors, clickIfPresent, detailReadyPredicate, installVisualDate, isExpectedCredentiallessBootstrapRejection, stableNativeFocus, watchApiErrors } from "./drivers/web.mjs";

test("motion capture skips the optional manual sign-in click when it is absent", async () => {
  let clicks = 0;
  await clickIfPresent({ count: async () => 0, click: async () => { clicks += 1; } });
  assert.equal(clicks, 0);
  await clickIfPresent({ count: async () => 1, click: async () => { clicks += 1; } });
  assert.equal(clicks, 1);
});

test("the driver's response listener fails the current readiness step and allows a later clean step", async () => {
  const apiErrors = [];
  const handlers = new Map();
  watchApiErrors({ on(event, handler) { handlers.set(event, handler); } }, apiErrors);
  const request = { method: () => "GET" };
  handlers.get("request")(request);
  await handlers.get("response")({ status: () => 401, url: () => "https://example.test/api/v1/library", request: () => request });
  assert.throws(() => assertWebReady("https://example.test/", apiErrors), /web readiness failed: 401 \/api\/v1\/library/);
  assert.deepEqual(apiErrors, [], "the failed step consumes the errors it reports");
  assert.doesNotThrow(() => assertWebReady("https://example.test/", apiErrors));
});

test("only a pre-submit credentialless auth rejection is cleared after manual sign-in succeeds", async () => {
  const expected = { status: 400, method: "POST", pathname: "/api/v1/auth/login", requestBody: {},
    responseBody: { error: "bad_request", message: "credentials required for full-account login" }, beforeManualLogin: true };
  assert.equal(isExpectedCredentiallessBootstrapRejection(expected), true);
  assert.equal(isExpectedCredentiallessBootstrapRejection({ ...expected, responseBody: { error: "bad_request", message: "a pin is required for managed-profile login" } }), true);
  assert.equal(isExpectedCredentiallessBootstrapRejection({ ...expected, responseBody: { error: "unauthorized", message: "invalid username or password" } }), false);
  assert.equal(isExpectedCredentiallessBootstrapRejection({ ...expected, beforeManualLogin: false }), false);
  assert.equal(isExpectedCredentiallessBootstrapRejection({ ...expected, requestBody: { username: "user" } }), false);
  assert.equal(isExpectedCredentiallessBootstrapRejection({ ...expected, status: 401 }), false);

  const observe = async ({ manualLoginSucceeded, status = 400, requestBody = {}, responseBody = expected.responseBody }) => {
    const errors = [];
    const handlers = new Map();
    let manualLoginStarted = false;
    const drain = watchApiErrors({ on(event, handler) { handlers.set(event, handler); } }, errors, {
      manualLoginStarted: () => manualLoginStarted,
      manualLoginSucceeded: () => manualLoginSucceeded,
    });
    const request = { method: () => "POST", postDataJSON: () => requestBody };
    handlers.get("request")(request);
    manualLoginStarted = true;
    await handlers.get("response")({
      status: () => status,
      url: () => "https://example.test/api/v1/auth/login",
      request: () => request,
      json: async () => responseBody,
    });
    await drain();
    return errors;
  };
  const successfulLoginErrors = await observe({ manualLoginSucceeded: true });
  assert.deepEqual(successfulLoginErrors, [], "a successful manual sign-in suppresses only the known bootstrap response");
  const deferredErrors = await observe({ manualLoginSucceeded: false });
  assert.equal(deferredErrors.length, 1, "without successful sign-in, the rejected bootstrap remains fatal");
  clearSuccessfulBootstrapLoginErrors(deferredErrors);
  assert.equal(deferredErrors.length, 0, "the successful sign-in path clears that exact bootstrap response");
  const credentialErrors = await observe({ manualLoginSucceeded: false, status: 401,
    requestBody: { username: "account", password: "wrong" }, responseBody: { error: "unauthorized", message: "invalid username or password" } });
  assert.equal(credentialErrors.length, 1, "a rejected credentialed sign-in is never classified as bootstrap");
  assert.equal(credentialErrors[0].expectedBootstrapLogin, false);
  assert.throws(() => assertWebReady("https://example.test/", credentialErrors), /401 \/api\/v1\/auth\/login/);
});

test("visual Date pins no-argument dates while wall-clock expiry continues and explicit dates are preserved", () => {
  let wallNow = 1_800_000_000_000;
  function FakeDate(...args) {
    if (!new.target) return `wall:${wallNow}`;
    return Reflect.construct(Date, args.length ? args : [wallNow], new.target);
  }
  FakeDate.prototype = Date.prototype;
  Object.setPrototypeOf(FakeDate, Date);
  FakeDate.now = () => wallNow;
  const target = { Date: FakeDate };
  installVisualDate("2026-10-07T12:00:00Z", target);
  const visualNow = Date.parse("2026-10-07T12:00:00Z");
  assert.equal(new target.Date().valueOf(), visualNow);
  assert.equal(target.Date(), `wall:${wallNow}`, "calling Date without new retains native callable semantics");
  assert.equal(new target.Date() instanceof target.Date, true);
  const explicit = new target.Date("2031-04-05T06:07:08Z");
  assert.equal(explicit.toISOString(), "2031-04-05T06:07:08.000Z");

  const session = { expiresAt: wallNow + 15_000 };
  const hasValidAccessToken = (nowMs = target.Date.now()) => session.expiresAt > nowMs;
  assert.equal(hasValidAccessToken(), true);
  wallNow += 20_000;
  assert.equal(target.Date.now(), 1_800_000_020_000);
  assert.equal(hasValidAccessToken(), false, "the auth expiry predicate observes advancing wall time");
  assert.equal(new target.Date().valueOf(), visualNow, "calendar time remains pinned after wall time advances");
});

const focusable = (key) => ({
  isConnected: true,
  id: key,
  tagName: "BUTTON",
  textContent: key,
  className: "",
  getAttribute(name) { return name === "data-navigation-focus-key" ? key : null; },
  getBoundingClientRect() { return { x: 10, y: 20, width: 30, height: 40 }; },
});

test("Playwright polling receives synchronous native-focus samples", () => {
  const stale = focusable("stale");
  const target = focusable("target");
  const body = { hasAttribute: (name) => name === "data-remote-marker" };
  const doc = { body, activeElement: stale, querySelector: () => target };
  const poll = (predicate, arg) => Boolean(predicate(arg));

  assert.equal(poll(stableNativeFocus, doc), false, "marker mismatch must remain false to Playwright's synchronous poller");
  doc.activeElement = target;
  assert.equal(poll(stableNativeFocus, doc), false, "first converged frame starts the stability window");
  assert.equal(poll(stableNativeFocus, doc), true, "second matching frame completes the stability window");
  assert.equal(poll(stableNativeFocus, doc), true, "stable focus remains ready");
});

test("native focus without an active virtual marker also needs stable polling", () => {
  const native = focusable("native");
  const doc = { body: { hasAttribute: () => false }, activeElement: native, querySelector: () => null };
  assert.equal(stableNativeFocus(doc), false);
  assert.equal(stableNativeFocus(doc), true);
});

test("Playwright's explicit undefined argument resolves the page document", () => {
  const native = focusable("native");
  const doc = { body: { hasAttribute: () => false }, activeElement: native, querySelector: () => null };
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: doc });
  try {
    assert.equal(stableNativeFocus(undefined), false);
    assert.equal(stableNativeFocus(undefined), true);
  } finally {
    if (previous) Object.defineProperty(globalThis, "document", previous);
    else delete globalThis.document;
  }
});

test("detail readiness stays synchronous and waits for source-specific image decoding", async () => {
  let resolveDecode;
  let decodeCalls = 0;
  const image = {
    complete: true,
    naturalWidth: 1,
    currentSrc: "fixture-art-a",
    decode() { decodeCalls += 1; return new Promise((resolve) => { resolveDecode = resolve; }); },
    getBoundingClientRect() { return { width: 10, height: 10 }; },
  };
  const heading = { textContent: "Movies" };
  const title = { textContent: "Test Movie A" };
  const focusKey = { getAttribute: () => "detail:fixture-work:play" };
  const copy = {
    classList: { contains: () => false },
    getAttribute: () => null,
    querySelector: () => title,
  };
  const art = { querySelectorAll: () => [image] };
  const detail = {
    querySelector(selector) {
      if (selector === ".tv-detail-copy") return copy;
      if (selector === ".page-header-title-block h1") return heading;
      if (selector === ".tv-key-art") return art;
      return null;
    },
    querySelectorAll(selector) { return selector === "[data-navigation-focus-key]" ? [focusKey] : []; },
    getAttribute: () => "Test Movie A",
  };
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const previousStyle = Object.getOwnPropertyDescriptor(globalThis, "getComputedStyle");
  Object.defineProperty(globalThis, "document", { configurable: true, value: { querySelector: () => detail } });
  Object.defineProperty(globalThis, "getComputedStyle", { configurable: true, value: () => ({ display: "block", visibility: "visible", opacity: "1" }) });
  try {
    const args = { workId: "fixture-work", kindHeading: "Movies", needsAction: false };
    const poll = () => Boolean(detailReadyPredicate(args));
    assert.equal(poll(), false, "poll returns false synchronously while image decode is pending");
    assert.equal(decodeCalls, 1);
    resolveDecode();
    await Promise.resolve();
    assert.equal(poll(), true, "poll becomes ready after the matching image source decodes");
    assert.equal(decodeCalls, 1, "the same source is not decoded repeatedly");
    image.currentSrc = "fixture-art-b";
    assert.equal(poll(), false, "a changed image source invalidates readiness");
    assert.equal(decodeCalls, 2);
  } finally {
    if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument);
    else delete globalThis.document;
    if (previousStyle) Object.defineProperty(globalThis, "getComputedStyle", previousStyle);
    else delete globalThis.getComputedStyle;
  }
});

test("search readiness accepts the search form, which phones show while they hide the prompt", () => {
  const source = readFileSync(new URL("./drivers/web.mjs", import.meta.url), "utf8");
  const selector = source.match(/path === "\/search"\) await page\.waitForSelector\("([^"]+)"/)?.[1] ?? "";
  for (const part of [".tv-search-results-grid", ".tv-search-empty", ".tv-search-prompt", ".tv-search-form"]) assert.ok(selector.includes(part), `${part} missing from ${selector}`);
});
