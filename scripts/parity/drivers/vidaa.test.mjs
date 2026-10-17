import test from "node:test";
import assert from "node:assert/strict";
import { createDriver, launchPath, sameState, suiteRoute, usableFrame } from "./vidaa.mjs";

const trusted = "https://test.example";
const secrets = { token: "tok", device: { PLAYARR_DEVICE_TEST_USERNAME: "device-test", PLAYARR_DEVICE_TEST_SERVER_URL: trusted } };
const identity = { username: "device-test", isCurrentCount: 1, serverUrl: trusted };

test("route helpers drop mirror flags and keep real queries", () => {
  assert.equal(suiteRoute("/calendar?view=month&mirrorPng=1&platform=tv-vidaa&r=5"), "/calendar?view=month");
  assert.equal(suiteRoute("/#/movies?mirrorTheme=dark"), "/movies");
  assert.equal(launchPath("/", { theme: "light", fixedNow: "2026-10-07T12:00:00.000Z" }), "/?mirrorPng=1&mirrorPointer=1&mirrorTheme=light&mirrorNow=2026-10-07T12%3A00%3A00");
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

function harness(frames) {
  const cli = [];
  let t = 100;
  let i = 0;
  const driver = createDriver({
    secrets, env: {}, runCli: (a) => { cli.push(a); return ""; },
    getJson: async () => frames[Math.min(i++, frames.length - 1)],
    getBuffer: async () => Buffer.from("png"),
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
