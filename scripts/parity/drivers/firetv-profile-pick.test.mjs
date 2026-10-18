import test from "node:test";
import assert from "node:assert/strict";
import { intoHome } from "./firetv-profile-pick.mjs";

const rig = (routes) => {
  const presses = [];
  let i = 0;
  return { presses, io: { state: async () => ({ route: routes[Math.min(i++, routes.length - 1)] }), press: async (k) => presses.push(k), sleep: async () => {}, polls: 2, attempts: 3 } };
};

test("presses Enter only once the app reports the picker", async () => {
  const presses = [];
  const answers = [null, null, null, "/profiles", "/"]; // two polls without an answer, then the picker shows, then Home
  const io = { state: async () => { const v = answers.length ? answers.shift() : "/"; if (v === null) throw new Error("no answer"); return { route: v }; }, press: async (k) => presses.push(k), sleep: async () => {}, polls: 2, attempts: 3 };
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
