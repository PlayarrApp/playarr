import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { storeSecrets } from "./dpad-account.mjs";

const scratchRoot = process.env.PLAYARR_PARITY_TEST_OUT;
if (!scratchRoot) throw new Error("PLAYARR_PARITY_TEST_OUT must point to the parity test output directory");

function fixtureFile() {
  fs.mkdirSync(scratchRoot, { recursive: true });
  const directory = fs.mkdtempSync(path.join(scratchRoot, "dpad-account-"));
  const file = path.join(directory, "secrets.fixture");
  return { file, directory };
}

function backups(file) {
  return fs.readdirSync(path.dirname(file)).filter((name) => name.startsWith("secrets.fixture.bak."));
}

test("unchanged secret values do not rewrite the file or create a backup", () => {
  const { file } = fixtureFile();
  const initial = "# retained comment\nALPHA=one\n\nBETA=two\n";
  fs.writeFileSync(file, initial, { mode: 0o600 });
  const before = fs.statSync(file);

  storeSecrets({ ALPHA: "one", NEW_VALUE: null }, file);

  assert.equal(fs.readFileSync(file, "utf8"), initial);
  assert.equal(fs.statSync(file).mtimeMs, before.mtimeMs);
  assert.deepEqual(backups(file), []);
});

test("quoted secret value with unchanged content keeps its formatting without a backup", () => {
  const { file } = fixtureFile();
  const initial = "# account\nTOKEN=\"same\"\n";
  fs.writeFileSync(file, initial, { mode: 0o600 });
  const before = fs.statSync(file);

  storeSecrets({ TOKEN: "same" }, file);

  assert.equal(fs.readFileSync(file, "utf8"), initial);
  assert.equal(fs.statSync(file).mtimeMs, before.mtimeMs);
  assert.deepEqual(backups(file), []);
});

test("changed values are atomically replaced while retaining formatting and creating one backup", () => {
  const { file } = fixtureFile();
  const initial = "# top comment\nKEEP=untouched\n\nCHANGE=old\n# trailing comment\nREMOVE=old\n";
  fs.writeFileSync(file, initial, { mode: 0o640 });
  let renameSource;
  let renameTarget;
  const realRename = fs.renameSync;
  const trackRename = (source, target) => {
    renameSource = source;
    renameTarget = target;
    assert.notEqual(source, file, "replacement must be written to a temporary file");
    assert.equal(fs.statSync(source).mode & 0o777, 0o600, "temporary secrets file must be private before rename");
    realRename(source, target);
  };
  fs.renameSync = trackRename;
  try {
    storeSecrets({ CHANGE: "new", REMOVE: null, ADDED: "value" }, file);
  } finally {
    fs.renameSync = realRename;
  }

  assert.equal(renameTarget, file);
  assert.equal(fs.existsSync(renameSource), false);
  assert.equal(fs.readFileSync(file, "utf8"), "# top comment\nKEEP=untouched\n\nCHANGE=new\n# trailing comment\nADDED=value\n");
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(backups(file).length, 1);
  const backup = path.join(path.dirname(file), backups(file)[0]);
  assert.equal(fs.readFileSync(backup, "utf8"), initial);
  assert.equal(fs.statSync(backup).mode & 0o777, 0o600);
});

test("updated duplicate keys retain their first position and remove later duplicates", () => {
  const { file } = fixtureFile();
  const initial = "# heading\nTOKEN=old-first\n\nKEEP=middle\nTOKEN=old-second\n";
  fs.writeFileSync(file, initial, { mode: 0o600 });

  storeSecrets({ TOKEN: "replacement" }, file);

  assert.equal(fs.readFileSync(file, "utf8"), "# heading\nTOKEN=replacement\n\nKEEP=middle\n");
  assert.equal(backups(file).length, 1);
});

test("a later real change creates one new backup without replacing prior backups", () => {
  const { file } = fixtureFile();
  fs.writeFileSync(file, "TOKEN=first\n", { mode: 0o600 });
  const retainedBackup = `${file}.bak.retained-${crypto.randomUUID()}`;
  fs.writeFileSync(retainedBackup, "prior backup", { mode: 0o600 });

  storeSecrets({ TOKEN: "second" }, file);

  assert.equal(fs.readFileSync(retainedBackup, "utf8"), "prior backup");
  assert.equal(backups(file).length, 2);
});

test("login tokens stay in memory across repeated logins without changing secrets or backups", async () => {
  const { directory } = fixtureFile();
  const file = path.join(directory, ".secrets");
  const initial = "PARITY_USERNAME=fixture-user\nPARITY_PASSWORD=fixture-pass\n";
  fs.writeFileSync(file, initial, { mode: 0o600 });
  const modulePath = fileURLToPath(new URL("./dpad-account.mjs", import.meta.url));
  const childSource = `
    let callCount = 0;
    globalThis.fetch = async () => { callCount++; return new Response(JSON.stringify({ access_token: "fixture-access-" + callCount, refresh_token: "fixture-refresh-" + callCount })); };
    const { login } = await import(${JSON.stringify(modulePath)});
    await login("https://example.invalid", "fixture-user", "fixture-pass", "parity-test", "PLAYARR_PARITY_TEST_ACCESS_TOKEN");
    await login("https://example.invalid", "fixture-user", "fixture-pass", "parity-test", "PLAYARR_PARITY_TEST_ACCESS_TOKEN");
  `;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", childSource], { encoding: "utf8", env: { ...process.env, HOME: directory } });
  assert.equal(child.status, 0, child.stderr || child.stdout);
  assert.equal(fs.readFileSync(file, "utf8"), initial);
  assert.deepEqual(fs.readdirSync(directory).filter((name) => name.startsWith(".secrets.bak.")), []);
});

test("storeSecrets reclaims a dead PID lock", () => {
  const { file } = fixtureFile();
  fs.writeFileSync(file, "VALUE=old\n", { mode: 0o600 });
  const lock = `${file}.lock`;
  fs.writeFileSync(lock, "999999999\n", { mode: 0o600 });
  storeSecrets({ VALUE: "new" }, file);
  assert.equal(fs.readFileSync(file, "utf8"), "VALUE=new\n");
  assert.equal(fs.existsSync(lock), false);
  assert.equal(backups(file).length, 1);
});

test("storeSecrets reclaims an empty lock older than 30 seconds", () => {
  const { file } = fixtureFile();
  fs.writeFileSync(file, "VALUE=old\n", { mode: 0o600 });
  const lock = `${file}.lock`;
  fs.writeFileSync(lock, "", { mode: 0o600 });
  const old = new Date(Date.now() - 60_000);
  fs.utimesSync(lock, old, old);
  storeSecrets({ VALUE: "new" }, file);
  assert.equal(fs.readFileSync(file, "utf8"), "VALUE=new\n");
  assert.equal(fs.existsSync(lock), false);
});
