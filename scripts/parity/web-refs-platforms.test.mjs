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

test("the Tizen 6.5 dir has its own group: webOS platform capture, player-controls shot with the video hidden, no other group lists it or hides video", () => {
  const t = manifest.groups["tv-tizen65"];
  assert.deepEqual(t.dirs, ["tizen65"]);
  assert.equal(t.userAgent, "tv-webos");
  assert.equal(t.platformBuild, "tv-webos");
  assert.equal(t.hideVideo, true);
  assert.deepEqual(t.viewport, manifest.groups.tv.viewport);
  assert.equal(t.dpr, manifest.groups.tv.dpr);
  for (const [name, g] of Object.entries(manifest.groups)) if (name !== "tv-tizen65") assert.ok(!g.dirs.includes("tizen65") && !Object.values(g.userAgents ?? {}).flat().includes("tizen65"), name);
  assert.ok(Object.entries(manifest.groups).filter(([, g]) => g.hideVideo).map(([k]) => k).includes("tv-tizen65"));
});
