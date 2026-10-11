// entry/src/test/WatchLeaves.test.ts: core/WatchLeaves.ts against web lib/playableLeaves.ts.
import { test } from "node:test";
import { strict as assert } from "node:assert";

import { watchLeaves } from "../main/ets/core/WatchLeaves";
import type { WorkDetail } from "../main/ets/core/Types/WorkDetail";

const base = { work: { id: "w", kind: "movie", title: "T" }, available_on: [] };
const detail = (over: object): WorkDetail => ({ ...base, children: "Movie", media_file_id: null, runtime_ms: null, ...over }) as unknown as WorkDetail;

test("movie leaf is the work's own file", () => {
  assert.deepEqual(watchLeaves(detail({ media_file_id: "f1", runtime_ms: 5000 })), [{ mediaFileId: "f1", runtimeMs: 5000 }]);
  assert.deepEqual(watchLeaves(detail({})), []);
});

test("series episodes come in season then episode order, unsynced skipped", () => {
  const ep = (n: number, file: string | null) => ({ episode: { episode_number: n }, media_file_id: file, runtime_ms: n * 10 });
  const d = detail({ children: { Series: [
    { season: { season_number: 2 }, episodes: [ep(1, "s2e1")] },
    { season: { season_number: 1 }, episodes: [ep(2, "s1e2"), ep(1, "s1e1"), ep(3, null)] },
  ] } });
  assert.deepEqual(watchLeaves(d).map((l) => l.mediaFileId), ["s1e1", "s1e2", "s2e1"]);
});

test("artist tracks use runtime, else duration seconds", () => {
  const d = detail({ children: { Artist: [{ tracks: [
    { track: { duration_seconds: 3 }, media_file_id: "t1", runtime_ms: null },
    { track: {}, media_file_id: "t2", runtime_ms: 9 },
  ] }] } });
  assert.deepEqual(watchLeaves(d), [{ mediaFileId: "t1", runtimeMs: 3000 }, { mediaFileId: "t2", runtimeMs: 9 }]);
});
