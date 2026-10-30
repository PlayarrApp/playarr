import test from "node:test";
import assert from "node:assert/strict";
import { PIN_PLAYER_EXPRESSION, cliFailure, createDriver, jobFrameProblem, launchPath, sameState, suiteRoute, usableFrame } from "./vidaa.mjs";

const trusted = "https://test.example";
const secrets = { token: "tok", device: { PLAYARR_DEVICE_TEST_USERNAME: "device-test", PLAYARR_DEVICE_TEST_SERVER_URL: trusted } };
const identity = { username: "device-test", isCurrentCount: 1, serverUrl: trusted };

test("route helpers drop mirror flags and keep real queries", () => {
  assert.equal(suiteRoute("/calendar?view=month&mirrorPng=1&platform=tv-vidaa&r=5"), "/calendar?view=month");
  assert.equal(suiteRoute("/#/movies?mirrorTheme=dark"), "/movies");
  assert.equal(launchPath("/", { theme: "light", fixedNow: "2026-10-07T12:00:00.000Z" }), "/?mirrorPng=1&mirrorPointer=1&mirrorWidth=1920&mirrorTheme=light&mirrorNow=2026-10-07T12%3A00%3A00Z&mirrorUtc=1");
  assert.throws(() => launchPath("//evil.example", { theme: "dark" }), /plain app route/);
  assert.throws(() => launchPath("/x y", { theme: "dark" }), /plain app route/);
});

test("frame freshness and state comparison", () => {
  assert.equal(usableFrame({ hasImage: true, receivedAt: 10 }, 5), true);
  assert.equal(usableFrame({ hasImage: true, receivedAt: 4 }, 5), false);
  assert.equal(usableFrame({ hasImage: true, receivedAt: 10, captureError: "x" }, 5), false);
  assert.equal(sameState({ route: "/a", focus: { x: 1 }, text: "t" }, { route: "/a?r=1", focus: { x: 1 }, text: "t" }), true);
  assert.equal(sameState({ route: "/a", text: "t" }, { route: "/b", text: "t" }), false);
});

function harness(frames, posted = []) {
  const cli = [];
  let t = 100;
  let i = 0;
  const driver = createDriver({
    secrets, env: {}, runCli: (a) => { cli.push(a); return ""; },
    // the last frame repeats as a fresh frame each poll (receivedAt advances), as a running page posts them
    getJson: async () => { const n = i++; const f = frames[Math.min(n, frames.length - 1)]; return n < frames.length ? f : { ...f, receivedAt: f.receivedAt + n }; },
    getBuffer: async () => Buffer.from("png"),
    postJson: async (u, body) => { posted.push({ url: u, body }); },
    delay: async () => { t += 1; }, now: () => t,
  });
  return { driver, cli };
}
const frame = (over = {}) => ({ hasImage: true, receivedAt: 1000, route: "/", focus: { label: "Home" }, text: "Hello", identity, ...over });

test("a key press goes out as a remote key and waits for a settled frame", async () => {
  const { driver, cli } = harness([frame()]);
  const d = await driver;
  await d.key("select");
  assert.deepEqual(cli[0].slice(0, 2), ["key", "KEY_OK"]);
  assert.deepEqual(await d.focused(), { label: "Home", position: null });
});

test("a frame from another account is rejected", async () => {
  const { driver } = harness([frame({ identity: { ...identity, username: "someone-else" } })]);
  const d = await driver;
  await assert.rejects(d.location(), /account guard/);
});

test("an empty page is never captured and an unknown key is refused", async () => {
  const { driver } = harness([frame({ text: "" })]);
  const d = await driver;
  await assert.rejects(d.home(), /no text/);
  await assert.rejects(d.key("play"), /cannot send/);
});

test("one frame polled twice is not settled: its image can predate the key", async () => {
  let t = 100;
  const same = frame();
  const d = await createDriver({
    secrets, env: {}, runCli: () => "", getJson: async () => same, getBuffer: async () => Buffer.from("png"),
    delay: async () => { t += 1; }, now: () => t, settleTimeoutMs: 5000,
  });
  await assert.rejects(d.location(), /no settled frame/);
});

test("a stale-image frame is skipped: settles only on two distinct matching frames", async () => {
  const { driver } = harness([frame({ route: "/movies", receivedAt: 1000 }), frame({ route: "/movies", receivedAt: 1010 })]);
  const d = await driver;
  assert.equal(await d.location(), "/movies");
});

test("a failed CLI call reports the CLI's own message on one line", () => {
  assert.equal(cliFailure(["key", "KEY_DOWN"], { stderr: "abort: identity heartbeat is stale\n", status: 1 }), "vidaa key failed: abort: identity heartbeat is stale");
  assert.equal(cliFailure(["state"], { stderr: "", status: 1 }), "vidaa state failed (exit 1)");
});

test("a long select goes out as the remote's own long-press key; a long back is refused", async () => {
  const { driver, cli } = harness([frame()]);
  const d = await driver;
  await d.key("select", { long: true });
  assert.deepEqual(cli[0].slice(0, 2), ["key", "KEY_OK_LONG_PRESS"]);
  await assert.rejects(d.key("back", { long: true }), /cannot send a long back/);
});

test("back is asked of the page as a one-shot command, never sent as a remote key", async () => {
  const posted = [];
  const { driver, cli } = harness([frame()], posted);
  const d = await driver;
  await d.key("back");
  assert.equal(cli.length, 0);
  assert.equal(posted.length, 1);
  assert.match(posted[0].url, /\/__mirror\/cmd\?/);
  assert.equal(posted[0].body.key, "back");
});

const withLayout = (id, over = {}) => frame({ requestId: id, layoutStable: true, layout: { viewport: { w: 1920, h: 1080, dpr: 1 }, elements: [{ text: "x" }], occluded: 0 }, ...over });

test("a layout job frame is usable only with its own id, a stable page and exported elements", () => {
  assert.equal(jobFrameProblem(withLayout("a"), "a"), null);
  assert.match(jobFrameProblem(withLayout("a"), "b"), /request id/);
  assert.match(jobFrameProblem(withLayout("a", { layoutStable: false }), "a"), /changed while/);
  assert.match(jobFrameProblem(withLayout("a", { layout: { error: "boom" } }), "a"), /layout export failed: boom/);
  assert.match(jobFrameProblem(withLayout("a", { hasImage: false }), "a"), /no image/);
  assert.match(jobFrameProblem(withLayout("a", { captureError: "x" }), "a"), /capture error/);
});

function pairingHarness(frameFor) {
  const posted = [];
  const png = Buffer.alloc(32); png.writeUInt32BE(0x89504e47, 0); png.writeUInt32BE(1920, 16); png.writeUInt32BE(1080, 20);
  let t = 100;
  const fetched = [];
  return createDriver({
    secrets, env: {}, runCli: () => "",
    getJson: async (u) => {
      if (u.includes("/frame.json")) { const id = new URL(u).searchParams.get("id"); fetched.push(id); return frameFor(id, fetched.length); }
      return frame({ receivedAt: t += 5 });
    },
    getBuffer: async (u) => { fetched.push(`png:${new URL(u).searchParams.get("id")}`); return png; },
    postJson: async (u, body) => { posted.push({ url: u, body }); },
    delay: async () => { t += 1; }, now: () => t, settleTimeoutMs: 20000,
  }).then((d) => ({ d, posted, fetched }));
}

test("screenshot saves the frame that carries the job id and the layout is that frame's own", async () => {
  const { mkdtempSync, readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const { d, posted, fetched } = await pairingHarness((id) => withLayout(id, { receivedAt: 2000 }));
  await d.setCaptureTarget("home");
  const file = join(mkdtempSync(join(tmpdir(), "vidaa-")), "home.png");
  await d.screenshot(file);
  assert.equal(readFileSync(file).length, 32);
  assert.equal(posted[0].body.id, fetched[0]);
  assert.match(posted[0].body.expr, /occluded/);
  assert.equal(fetched[1], `png:${posted[0].body.id}`);
  const doc = await d.layoutDump({ screen: "home", theme: "dark" });
  assert.equal(doc.elements.length, 1);
  await assert.rejects(d.layoutDump({ screen: "movies", theme: "dark" }), /no screenshot frame/);
});

test("a frame whose state differs from the settled page is refused after four attempts", async () => {
  const { d } = await pairingHarness((id) => withLayout(id, { text: "another screen" }));
  await d.setCaptureTarget("home");
  await assert.rejects(d.screenshot("/nonexistent/x.png"), /refused after 4 attempts: route, focus or text differ/);
});

test("a playing player is pinned to its 2.000 s frame through a page job before the page counts as settled", async () => {
  const posted = [];
  let t = 100;
  let pinnedId = null;
  const d = await createDriver({
    secrets, env: {}, runCli: () => "",
    getJson: async (u) => {
      if (u.includes("/frame.json")) { const id = new URL(u).searchParams.get("id"); return pinnedId === id ? { ...frame({ route: "/player/x", receivedAt: t }), requestId: id, layout: { held: true } } : {}; }
      return frame({ route: "/player/x", text: `0:0${t % 7}`, receivedAt: t += 5 }); // the label ticks while playing
    },
    getBuffer: async () => Buffer.from("png"),
    postJson: async (u, body) => { posted.push(body); pinnedId = body.id; },
    delay: async () => { t += 1; }, now: () => t, settleTimeoutMs: 20000,
  });
  await assert.rejects(d.location(), /no settled frame/); // the label still ticks in this fake, but the pin was requested first
  assert.equal(posted[0].expr, PIN_PLAYER_EXPRESSION);
  assert.match(PIN_PLAYER_EXPRESSION, /v\.currentTime = 2;/);
  assert.match(PIN_PLAYER_EXPRESSION, /v\.pause\(\);/);
});

test("a pin that cannot hold the frame fails the capture", async () => {
  let t = 100;
  let id = null;
  const d = await createDriver({
    secrets, env: {}, runCli: () => "",
    getJson: async (u) => u.includes("/frame.json") ? { ...frame({ route: "/player/x", receivedAt: t }), requestId: id, layout: { held: false, state: { t: 3.1 } } } : frame({ route: "/player/x", receivedAt: t += 5 }),
    getBuffer: async () => Buffer.from("png"), postJson: async (u, body) => { id = body.id; }, delay: async () => { t += 1; }, now: () => t, settleTimeoutMs: 20000,
  });
  await assert.rejects(d.location(), /did not hold paused on its 2.000 s frame/);
});

test("a Back injected into the page is reported once, a remote key is not", async () => {
  const { d, posted } = await pairingHarness((id) => withLayout(id, { receivedAt: 2000 }));
  await d.key("left");
  assert.equal(d.takeInjectedBack(), false);
  await d.key("back");
  assert.equal(posted.some((p) => p.body?.key === "back"), true);
  assert.equal(d.takeInjectedBack(), true);
  assert.equal(d.takeInjectedBack(), false);
});

test("detail routes are recognised for the page-top reset, other routes are not", async () => {
  const { isDetailRoute, DETAIL_TOP_EXPRESSION } = await import("./vidaa.mjs");
  assert.equal(isDetailRoute("/series/7ab4ce97-d59e-43d6-8e03-31d4d29a5c90"), true);
  assert.equal(isDetailRoute("/movies/abc?x=1"), true);
  assert.equal(isDetailRoute("/series"), false);
  assert.equal(isDetailRoute("/player/abc"), false);
  assert.match(DETAIL_TOP_EXPRESSION, /scrollTop = 0/);
});
