import { describe, expect, it } from "vitest";
import type { DownloadRecord } from "./downloadsDb";
import { offlineWorkDetail } from "./offlineWorkDetail";

const rec = (over: Partial<DownloadRecord>): DownloadRecord => ({
  id: "d", workId: "w", workKind: "movie", mediaFileId: "m", userId: "u", serverUrl: "s", title: "Film", subtitle: null,
  qualityId: "q", qualityLabel: "1080p", container: "mp4", totalBytes: 1, bytesDownloaded: 1, lastCompletedByteOffset: 0,
  status: "ready", keepUntil: { type: "forever" }, watchedAt: null, errorMessage: null, requestedAt: "2026-10-01T00:00:00Z",
  readyAt: null, storage: "idb-blob", runtimeMs: 5000, mimeType: "video/mp4", ...over,
});

describe("offlineWorkDetail", () => {
  it("builds a movie from its ready download", () => {
    const d = offlineWorkDetail([rec({})], "w");
    expect(d?.work.title).toBe("Film");
    expect(d?.media_file_id).toBe("m");
  });
  it("ignores unfinished downloads and other works", () => {
    expect(offlineWorkDetail([rec({ status: "paused" }), rec({ workId: "x" })], "w")).toBeNull();
  });
  it("groups episodes by season in order", () => {
    const d = offlineWorkDetail(
      [
        rec({ id: "b", mediaFileId: "e2", workKind: "series", seriesTitle: "Show", seasonNumber: 1, episodeNumber: 2 }),
        rec({ id: "a", mediaFileId: "e1", workKind: "series", seriesTitle: "Show", seasonNumber: 1, episodeNumber: 1 }),
        rec({ id: "c", mediaFileId: "e3", workKind: "series", seriesTitle: "Show", seasonNumber: 2, episodeNumber: 1 }),
      ],
      "w"
    );
    expect(d?.work.title).toBe("Show");
    const seasons = (d?.children as { Series: { season: { season_number: number }; episodes: { media_file_id: string }[] }[] }).Series;
    expect(seasons.map((s) => s.episodes.map((e) => e.media_file_id))).toEqual([["e1", "e2"], ["e3"]]);
  });
  it("groups an artist's tracks by album", () => {
    const d = offlineWorkDetail(
      [
        rec({ id: "t1", mediaFileId: "t1", workKind: "artist", title: "Song A", subtitle: "Band · First LP", requestedAt: "2026-10-01T00:00:01Z" }),
        rec({ id: "t2", mediaFileId: "t2", workKind: "artist", title: "Song B", subtitle: "Band · First LP", requestedAt: "2026-10-01T00:00:02Z" }),
        rec({ id: "t3", mediaFileId: "t3", workKind: "artist", title: "Song C", subtitle: "Band · Second LP" }),
      ],
      "w"
    );
    const albums = (d?.children as { Artist: { album: { title: string }; tracks: { track: { title: string; track_number: number } }[] }[] }).Artist;
    expect(albums.map((a) => [a.album.title, a.tracks.map((t) => t.track.title)])).toEqual([["First LP", ["Song A", "Song B"]], ["Second LP", ["Song C"]]]);
    expect(albums[0]!.tracks.map((t) => t.track.track_number)).toEqual([1, 2]);
  });
});
