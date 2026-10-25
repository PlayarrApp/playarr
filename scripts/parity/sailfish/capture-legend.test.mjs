import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import { after, test } from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertSafeScratch, publishRun, removeValidatedPngs, runCaptureLifecycle, validateRun } from "./capture-legend.mjs";

const screens = ["home", "movies", "series", "music", "calendar-month", "calendar-week", "calendar-agenda", "search", "film-detail", "series-detail", "settings", "filters", "profiles", "player-controls", "actions", "calendar-link"];
const themes = ["dark", "light"];
const testOut = process.env.PLAYARR_PARITY_TEST_OUT ?? tmpdir();
mkdirSync(testOut, { recursive: true });
const root = mkdtempSync(join(testOut, "playarr-sailfish-publisher-test-"));
after(() => rmSync(root, { recursive: true, force: true }));

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type), size = Buffer.alloc(4), checksum = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([size, name, data, checksum]);
}

function png() {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(768, 0); header.writeUInt32BE(1344, 4);
  header[8] = 8; header[9] = 0;
  const row = Buffer.alloc(769, 0);
  const raw = Buffer.alloc(row.length * 1344);
  for (let y = 0; y < 1344; y++) row.copy(raw, y * row.length);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0)),
  ]);
}

function fixture() {
  const runDir = join(root, `run-${Math.random().toString(36).slice(2)}`);
  const legendRoot = join(root, `legend-${Math.random().toString(36).slice(2)}`);
  const destination = join(legendRoot, "sailfish", "dev");
  mkdirSync(runDir, { recursive: true }); mkdirSync(join(legendRoot, "sailfish"), { recursive: true }); mkdirSync(destination);
  mkdirSync(join(destination, "layout"));
  const bytes = png();
  for (const theme of themes) {
    mkdirSync(join(runDir, theme));
    for (const screen of screens) writeFileSync(join(runDir, theme, `${screen}.png`), bytes);
  }
  return { runDir, legendRoot, destination };
}

function snapshot(dir) {
  const rows = [];
  const walk = (base, rel = "") => {
    for (const name of readdirSync(base).sort()) {
      const path = join(base, name), key = join(rel, name);
      if (statSync(path).isDirectory()) walk(path, key);
      else {
        const content = readFileSync(path);
        rows.push([key, createHash("sha256").update(content).digest("hex")]);
      }
    }
  };
  walk(dir);
  return JSON.stringify(rows);
}

const source = { branch: "parity-sailfish-test", sha: "a".repeat(40), manifestSha256: "b".repeat(64) };
const guest = { qmlManifestSha256: "c".repeat(64), executableSha256: "d".repeat(64) };

test("publishes only the complete PNG set and preserves unrelated JSON", () => {
  const f = fixture();
  writeFileSync(join(f.destination, "downloads.json"), '{"history":true}\n');
  writeFileSync(join(f.destination, "home.png"), Buffer.from("old"));
  const result = publishRun({ ...f, source, guestBefore: guest, guestAfter: guest, pr: 552, capturedAt: "2026-10-25T00:00:00Z" });
  assert.equal(result.screenshots, 32);
  assert.equal(readFileSync(join(f.destination, "home.png")).subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(readFileSync(join(f.destination, "downloads.json"), "utf8"), '{"history":true}\n');
  const build = JSON.parse(readFileSync(join(f.destination, "build.json"), "utf8"));
  assert.equal(build.sha, source.sha);
  assert.equal(build.pr, 552);
  assert.equal(build.layouts_published, false);
  assert.equal(readdirSync(join(f.destination, "light")).filter((name) => name.endsWith(".png")).length, 16);
  assert.equal(readdirSync(join(f.destination, "layout"), { withFileTypes: true }).length, 0);
});

test("rejects an incomplete run without changing the destination", () => {
  const f = fixture();
  writeFileSync(join(f.destination, "history.json"), "preserve\n");
  const before = snapshot(f.destination);
  rmSync(join(f.runDir, "dark", "home.png"));
  assert.throws(() => publishRun({ ...f, source, guestBefore: guest, guestAfter: guest }), /exactly 16 dark PNGs/);
  assert.equal(snapshot(f.destination), before);
});

test("rejects malformed PNGs and existing diagnostic layout JSON before mutation", () => {
  const f = fixture();
  writeFileSync(join(f.destination, "history.json"), "preserve\n");
  const before = snapshot(f.destination);
  writeFileSync(join(f.runDir, "light", "calendar-link.png"), Buffer.from("not a png"));
  assert.throws(() => validateRun(f.runDir), /Invalid PNG/);
  assert.throws(() => publishRun({ ...f, source, guestBefore: guest, guestAfter: guest }), /Invalid PNG/);
  assert.equal(snapshot(f.destination), before);
  writeFileSync(join(f.destination, "layout.json"), "native diagnostic\n");
  writeFileSync(join(f.destination, "layout", "dark.json"), "native diagnostic\n");
  const withLayout = snapshot(f.destination);
  assert.throws(() => publishRun({ ...f, source, guestBefore: guest, guestAfter: guest }), /layout JSON/);
  assert.equal(snapshot(f.destination), withLayout);
});

test("rejects symlink captures before changing the destination", () => {
  const f = fixture();
  writeFileSync(join(f.destination, "history.json"), "preserve\n");
  const before = snapshot(f.destination);
  const pngPath = join(f.runDir, "dark", "home.png");
  const targetPath = join(f.runDir, "dark", "movies.png");
  rmSync(pngPath);
  symlinkSync(targetPath, pngPath);
  assert.throws(() => publishRun({ ...f, source, guestBefore: guest, guestAfter: guest }), /not a regular file/);
  assert.equal(snapshot(f.destination), before);
});

test("rejects changed guest provenance and unsafe destination", () => {
  const f = fixture();
  assert.throws(() => publishRun({ ...f, source, guestBefore: guest, guestAfter: { ...guest, executableSha256: "e".repeat(64) } }), /changed during capture/);
  assert.throws(() => publishRun({ ...f, destination: join(f.legendRoot, "other", "dev"), source, guestBefore: guest, guestAfter: guest }), /exactly <legend-root>/);
});

test("requires capture scratch to be a canonical directory disjoint from the legend root", () => {
  const f = fixture();
  const scratch = join(root, `scratch-${Math.random().toString(36).slice(2)}`);
  mkdirSync(scratch);
  assert.equal(assertSafeScratch(scratch, f.legendRoot), scratch);
  const nestedScratch = join(f.legendRoot, "scratch");
  mkdirSync(nestedScratch);
  assert.throws(() => assertSafeScratch(nestedScratch, f.legendRoot), /outside and disjoint/);
});

test("raw cleanup removes only the same validated PNG bytes and preserves every JSON file", () => {
  const f = fixture();
  const history = join(f.runDir, "history.json");
  writeFileSync(history, '{"retained":true}\n');
  const captures = validateRun(f.runDir);
  removeValidatedPngs(captures);
  assert.equal(readFileSync(history, "utf8"), '{"retained":true}\n');
  assert.deepEqual(readdirSync(join(f.runDir, "dark")).filter((name) => name.endsWith(".png")), []);
  assert.deepEqual(readdirSync(join(f.runDir, "light")).filter((name) => name.endsWith(".png")), []);
});

test("raw cleanup refuses changed captures before deleting any PNG", () => {
  const f = fixture();
  const captures = validateRun(f.runDir);
  writeFileSync(captures["light/calendar-link"].path, Buffer.from("changed"));
  assert.throws(() => removeValidatedPngs(captures), /changed after validation/);
  assert.equal(readdirSync(join(f.runDir, "dark")).filter((name) => name.endsWith(".png")).length, 16);
  assert.equal(readdirSync(join(f.runDir, "light")).filter((name) => name.endsWith(".png")).length, 16);
});

test("capture lifecycle archives then cleans after capture failure and retains raw captures", async () => {
  const calls = [];
  await assert.rejects(runCaptureLifecycle({
    captureAndPublish: async () => { calls.push("capture"); throw new Error("capture failed"); },
    archive: async () => { calls.push("archive"); },
    cleanup: async () => { calls.push("cleanup"); },
    remove: async () => { calls.push("remove"); },
  }), /published: no.*capture: failed.*archive: ok.*cleanup: ok.*raw captures and JSON retained/);
  assert.deepEqual(calls, ["capture", "archive", "cleanup"]);
});

test("archive failure prevents cleanup and raw capture removal", async () => {
  const calls = [];
  await assert.rejects(runCaptureLifecycle({
    captureAndPublish: async () => { calls.push("capture and publish"); return { publication: { destination: "legend" }, captures: {} }; },
    archive: async () => { calls.push("archive"); throw new Error("archive failed"); },
    cleanup: async () => { calls.push("cleanup"); },
    remove: async () => { calls.push("remove"); },
  }), /published: yes.*archive: failed.*cleanup: not run after archive failure/);
  assert.deepEqual(calls, ["capture and publish", "archive"]);
});

test("reports the capture failure with archive failure and skips cleanup", async () => {
  const calls = [];
  await assert.rejects(runCaptureLifecycle({
    captureAndPublish: async () => { calls.push("capture"); throw new Error("original capture error"); },
    archive: async () => { calls.push("archive"); throw new Error("archive error"); },
    cleanup: async () => { calls.push("cleanup"); },
    remove: async () => { calls.push("remove"); },
  }), /capture: failed \(original capture error\).*archive: failed \(archive error\).*cleanup: not run after archive failure/);
  assert.deepEqual(calls, ["capture", "archive"]);
});
