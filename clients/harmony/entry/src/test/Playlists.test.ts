// entry/src/test/Playlists.test.ts: core/Playlists.ts against web pages/Playlists.tsx ordering and captions.
import { test } from "node:test";
import { strict as assert } from "node:assert";

import { childPlaylists, itemMediaFileId, itemsInOrder, moveId, playlistCaption, topLevelPlaylists } from "../main/ets/core/Playlists";
import type { PlaylistResponse } from "../main/ets/core/Types/Playlists";

const pl = (id: string, name: string, over: Partial<PlaylistResponse> = {}): PlaylistResponse =>
  ({ id, name, is_system: false, media_type: "video", ...over });

test("top level only, natural name order", () => {
  const list = [pl("a", "Mix 10"), pl("b", "mix 2"), pl("c", "Child", { parent_playlist_id: "a" }), pl("d", "Alpha")];
  assert.deepEqual(topLevelPlaylists(list).map((p) => p.id), ["d", "b", "a"]);
});

test("children of a parent", () => {
  const list = [pl("a", "Parent"), pl("c", "Zed", { parent_playlist_id: "a" }), pl("e", "Abe", { parent_playlist_id: "a" })];
  assert.deepEqual(childPlaylists(list, "a").map((p) => p.id), ["e", "c"]);
  assert.deepEqual(childPlaylists(list, "x"), []);
});

test("captions", () => {
  assert.equal(playlistCaption(pl("a", "n")), "Video · Playlist");
  assert.equal(playlistCaption(pl("a", "n", { is_system: true, media_type: "audio" })), "Music · System playlist");
});

test("items by position", () => {
  const items = [{ id: "2", work_id: "w", position: 2 }, { id: "1", work_id: "w", position: 1 }];
  assert.deepEqual(itemsInOrder(items).map((i) => i.id), ["1", "2"]);
});

test("moving an id up or down, clamped at the ends", () => {
  assert.deepEqual(moveId(["a", "b", "c"], 1, -1), ["b", "a", "c"]);
  assert.deepEqual(moveId(["a", "b", "c"], 1, 1), ["a", "c", "b"]);
  assert.deepEqual(moveId(["a", "b", "c"], 0, -1), ["a", "b", "c"]);
  assert.deepEqual(moveId(["a", "b", "c"], 2, 1), ["a", "b", "c"]);
});

test("an item plays its track, else the movie file, else the first file", () => {
  const detail = (over: object) => ({ work: { id: "w" }, children: "Movie", media_file_id: null, runtime_ms: null, ...over }) as unknown as import("../main/ets/core/Types/WorkDetail").WorkDetail;
  assert.equal(itemMediaFileId(detail({ media_file_id: "m1" }), null), "m1");
  const artist = detail({ children: { Artist: [{ tracks: [{ track: { id: "t1" }, media_file_id: "f1" }, { track: { id: "t2" }, media_file_id: "f2" }] }] } });
  assert.equal(itemMediaFileId(artist, "t2"), "f2");
  assert.equal(itemMediaFileId(artist, null), "f1");
  assert.equal(itemMediaFileId(detail({}), null), null);
});
