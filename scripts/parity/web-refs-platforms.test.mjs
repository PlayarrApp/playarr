import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const manifest = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "web-refs.json"), "utf8"));

test("every dir of a per-user-agent group belongs to exactly one variant, and webOS has its own platform build", () => {
  const g = manifest.groups.tv;
  const all = Object.values(g.userAgents).flat();
  assert.deepEqual([...new Set(all)].sort(), [...g.dirs].sort());
  assert.equal(all.length, g.dirs.length);
  assert.deepEqual(g.userAgents["tv-webos"], ["tizen-webos"]);
  assert.ok(!g.userAgents.xbox.includes("tizen-webos"));
});

test("the Harmony TV dir has its own group: xbox UA, player-controls shot with the video hidden, no other group hides video", () => {
  const h = manifest.groups["tv-harmony"];
  assert.deepEqual(h.dirs, ["harmony"]);
  assert.equal(h.userAgent, "xbox");
  assert.equal(h.hideVideo, true);
  assert.ok(!manifest.groups.tv.dirs.includes("harmony"));
  assert.deepEqual(Object.entries(manifest.groups).filter(([, g]) => g.hideVideo).map(([k]) => k), ["tv-harmony"]);
});
