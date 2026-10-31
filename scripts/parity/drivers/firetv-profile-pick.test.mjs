import test from "node:test";
import assert from "node:assert/strict";
import { intoHome } from "./firetv-profile-pick.mjs";

const rig = (routes) => {
  const presses = [];
  let i = 0;
  return { presses, io: { state: async () => ({ route: routes[Math.min(i++, routes.length - 1)], focus: { label: "device test" } }), press: async (k) => presses.push(k), sleep: async () => {}, polls: 2, attempts: 3 } };
};

test("presses Enter only once the app reports the picker", async () => {
  const presses = [];
  const answers = [null, null, null, "/profiles", "/"]; // two polls without an answer, then the picker shows, then Home
  const io = { state: async () => { const v = answers.length ? answers.shift() : "/"; if (v === null) throw new Error("no answer"); return { route: v, focus: { label: "device test" } }; }, press: async (k) => presses.push(k), sleep: async () => {}, polls: 2, attempts: 3 };
  assert.equal((await intoHome(io)).route, "/");
  assert.deepEqual(presses, ["Return"]);
});

test("presses Enter again when the first one was lost", async () => {
  const { presses, io } = rig(["/profiles", "/profiles", "/profiles", "/profiles", "/profiles", "/"]);
  assert.equal((await intoHome(io)).route, "/");
  assert.equal(presses.length, 2);
});

test("gives up when the picker never leaves", async () => {
  const { io } = rig(["/profiles"]);
  await assert.rejects(intoHome(io), /did not reach Home/);
});

test("does not press Select while no profile holds focus", async () => {
  const presses = [];
  const answers = [{ route: "/profiles", focus: null }, { route: "/profiles", focus: null }, { route: "/profiles", focus: { label: "device test" } }, { route: "/" }];
  const io = { state: async () => answers.shift() ?? { route: "/" }, press: async (k) => presses.push(k), sleep: async () => {}, polls: 3, attempts: 2 };
  assert.equal((await intoHome(io)).route, "/");
  assert.deepEqual(presses, ["Return"]);
});

test("reports a hung app when it stops answering after Select", async () => {
  const answers = ["/profiles"]; // the picker, then silence
  const io = { state: async () => { const v = answers.shift(); if (!v) throw new Error("no answer"); return { route: v, focus: { label: "device test" } }; }, press: async () => {}, sleep: async () => {}, polls: 5, attempts: 3 };
  await assert.rejects(intoHome(io), (error) => error.appHung === true && /stopped answering/.test(error.message));
});
