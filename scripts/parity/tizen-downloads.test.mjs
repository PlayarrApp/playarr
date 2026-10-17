import test from "node:test";
import assert from "node:assert/strict";
import { createDriver } from "./drivers/tizen-native.mjs";

const trusted = "https://test.example";
const accountEnv = { PLAYARR_USERNAME: "device-test", PLAYARR_TEST_SERVER_URL: trusted };
const secrets = { PLAYARR_DEVICE_TEST_USERNAME: "device-test", PLAYARR_TEST_SERVER_URL: trusted };
const media = {
  file: "file-a",
  work: "work-a",
  title: "Sample Series",
  season: 1,
  episode: 1,
};

function fakeRequest(initial = [], { failRemove = [] } = {}) {
  const records = structuredClone(initial);
  const requests = [];
  const failures = new Set(failRemove);
  let nextId = 1;

  return {
    records,
    requests,
    async request(method, path) {
      requests.push({ method, path });
      const url = new URL(path, "http://parity.invalid");
      if (method === "GET" && url.pathname === "/identity") return { username: "device-test", isCurrentCount: 1, serverUrl: trusted };
      if (method === "GET" && url.pathname === "/dl/list") return structuredClone(records);
      if (method === "POST" && url.pathname === "/dl/start") {
        const file = url.searchParams.get("file");
        const existing = records.find((record) => record.MediaFileId === file);
        const id = existing?.Id ?? `created-${nextId++}`;
        const record = {
          Id: id,
          MediaFileId: file,
          WorkId: url.searchParams.get("work"),
          SeriesTitle: url.searchParams.get("series"),
          Season: Number(url.searchParams.get("season")) || null,
          Episode: Number(url.searchParams.get("episode")) || null,
          state: "Ready",
          BytesDownloaded: 10,
          file: true,
          keep: "forever",
        };
        if (existing) Object.assign(existing, record);
        else records.push(record);
        return { id };
      }
      if (method === "POST" && url.pathname === "/dl/remove") {
        const id = url.searchParams.get("id");
        if (failures.has(id)) throw new Error("mock remove failed");
        const index = records.findIndex((record) => record.Id === id);
        if (index >= 0) records.splice(index, 1);
        return { ok: true };
      }
      if (method === "POST" && url.pathname === "/dl/group") {
        const season = url.searchParams.get("season");
        const matches = (record) => record.SeriesTitle === url.searchParams.get("series")
          && (season === null || String(record.Season) === season);
        for (let index = records.length - 1; index >= 0; index -= 1) {
          if (matches(records[index])) records.splice(index, 1);
        }
        return { count: 1 };
      }
      throw new Error(`unexpected mock request ${method} ${path}`);
    },
  };
}

const action = (name) => ({ action: name, media, expect: { withinSeconds: 1 } });

test("cleanup removes only downloads created by this driver", async () => {
  const fake = fakeRequest([{
    Id: "pre-existing",
    MediaFileId: "file-other",
    WorkId: "work-other",
    SeriesTitle: null,
    Season: null,
    state: "Ready",
    BytesDownloaded: 10,
    file: true,
    keep: "forever",
  }]);
  const driver = await createDriver({ request: fake.request, delay: async () => {}, env: accountEnv, secrets });

  assert.equal((await driver.download(action("start"))).state, "ok");
  fake.requests.length = 0;
  await driver.cleanupDownloads();

  assert.deepEqual(fake.requests, [{ method: "POST", path: "/dl/remove?id=created-1" }]);
  assert.deepEqual(fake.records.map((record) => record.Id), ["pre-existing"]);
});

test("start refuses an unowned ticket for the same media before calling start", async () => {
  const fake = fakeRequest([{
    Id: "pre-existing",
    MediaFileId: media.file,
    WorkId: media.work,
    SeriesTitle: media.title,
    Season: media.season,
    state: "Ready",
    BytesDownloaded: 10,
    file: true,
    keep: "forever",
  }]);
  const driver = await createDriver({ request: fake.request, delay: async () => {}, env: accountEnv, secrets });

  const result = await driver.download(action("start"));

  assert.equal(result.state, "failed");
  assert.match(result.detail, /existing download/);
  assert.equal(fake.requests.some(({ path }) => path.startsWith("/dl/start?")), false);
  assert.deepEqual(fake.records.map((record) => record.Id), ["pre-existing"]);
});

test("start fails closed when an old debug mirror omits ownership metadata", async () => {
  const fake = fakeRequest([{ Id: "unknown-ticket", state: "Ready", file: true }]);
  const driver = await createDriver({ request: fake.request, delay: async () => {}, env: accountEnv, secrets });

  const result = await driver.download(action("start"));

  assert.equal(result.state, "failed");
  assert.match(result.detail, /cannot be verified/);
  assert.equal(fake.requests.some(({ path }) => path.startsWith("/dl/start?")), false);
});

test("group action refuses matching unowned tickets and preserves them", async () => {
  const fake = fakeRequest([{
    Id: "pre-existing",
    MediaFileId: "file-other",
    WorkId: "work-other",
    SeriesTitle: media.title,
    Season: media.season,
    state: "Ready",
    BytesDownloaded: 10,
    file: true,
    keep: "forever",
  }]);
  const driver = await createDriver({ request: fake.request, delay: async () => {}, env: accountEnv, secrets });

  const result = await driver.download(action("season-delete"));

  assert.equal(result.state, "failed");
  assert.match(result.detail, /matching downloads already exist/);
  assert.equal(fake.requests.some(({ path }) => path.startsWith("/dl/group?")), false);
  assert.deepEqual(fake.records.map((record) => record.Id), ["pre-existing"]);
});

test("group action may remove a matching ticket owned by this driver only", async () => {
  const fake = fakeRequest([{
    Id: "unrelated-season",
    MediaFileId: "file-other",
    WorkId: "work-other",
    SeriesTitle: media.title,
    Season: 2,
    state: "Ready",
    BytesDownloaded: 10,
    file: true,
    keep: "forever",
  }]);
  const driver = await createDriver({ request: fake.request, delay: async () => {}, env: accountEnv, secrets });

  assert.equal((await driver.download(action("start"))).state, "ok");
  assert.equal((await driver.download(action("season-delete"))).state, "ok");

  assert.deepEqual(fake.records.map((record) => record.Id), ["unrelated-season"]);
});

test("cleanup continues after an owned-ticket removal error", async () => {
  const fake = fakeRequest([], { failRemove: ["created-1"] });
  const driver = await createDriver({ request: fake.request, delay: async () => {}, env: accountEnv, secrets });

  assert.equal((await driver.download(action("start"))).state, "ok");
  const secondMedia = { ...media, file: "file-b", episode: 2 };
  assert.equal((await driver.download({ ...action("start"), media: secondMedia })).state, "ok");
  fake.requests.length = 0;

  await assert.doesNotReject(driver.cleanupDownloads());

  assert.deepEqual(fake.requests.map(({ path }) => path), ["/dl/remove?id=created-1", "/dl/remove?id=created-2"]);
  assert.deepEqual(fake.records.map((record) => record.Id), ["created-1"]);
});
