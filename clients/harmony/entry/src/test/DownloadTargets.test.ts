// entry/src/test/DownloadTargets.test.ts: core/DownloadTargets.ts against web's download scope.
import { test } from "node:test";
import { strict as assert } from "node:assert";

import { downloadTargets } from "../main/ets/core/DownloadTargets";
import type { WorkDetail } from "../main/ets/core/Types/WorkDetail";

const detail = (over: object): WorkDetail => ({ work: { id: "w", title: "Show", kind: "series" }, children: "Movie", media_file_id: null, runtime_ms: null, ...over }) as unknown as WorkDetail;

test("a movie is its own file", () => {
  assert.deepEqual(downloadTargets(detail({ media_file_id: "m1" })), [{ mediaFileId: "m1", title: "Show" }]);
});

test("series episodes in order with season and episode in the title; unsynced skipped", () => {
  const ep = (n: number, f: string | null) => ({ episode: { episode_number: n }, media_file_id: f });
  const d = detail({ children: { Series: [
    { season: { season_number: 2 }, episodes: [ep(1, "b1")] },
    { season: { season_number: 1 }, episodes: [ep(2, "a2"), ep(1, "a1"), ep(3, null)] },
  ] } });
  assert.deepEqual(downloadTargets(d).map((t) => [t.mediaFileId, t.title]), [["a1", "Show · S1E1"], ["a2", "Show · S1E2"], ["b1", "Show · S2E1"]]);
});

test("artist tracks", () => {
  const d = detail({ children: { Artist: [{ tracks: [{ track: { title: "One" }, media_file_id: "t1" }, { track: { title: "Two" }, media_file_id: null }] }] } });
  assert.deepEqual(downloadTargets(d), [{ mediaFileId: "t1", title: "Show · One" }]);
  assert.deepEqual(downloadTargets(detail({})), []);
});
