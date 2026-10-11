import { describe, expect, it } from "vitest";
import type { DownloadRecord } from "./downloadsDb";
import {
  activeFilterCount,
  aggregateDownloads,
  buildDownloadTree,
  DEFAULT_DOWNLOAD_FILTERS,
  episodeIdentity,
  filterAndSortDownloads,
} from "./downloadGroups";

let counter = 0;
function record(over: Partial<DownloadRecord>): DownloadRecord {
  counter += 1;
  return {
    id: `d${counter}`,
    workId: "w1",
    workKind: "movie",
    mediaFileId: `m${counter}`,
    userId: "u",
    serverUrl: "s",
    title: `Item ${counter}`,
    subtitle: null,
    qualityId: "q",
    qualityLabel: "1080p",
    container: "mp4",
    totalBytes: 1000,
    bytesDownloaded: 0,
    lastCompletedByteOffset: 0,
    status: "ready",
    keepUntil: { type: "forever" },
    watchedAt: null,
    errorMessage: null,
    requestedAt: new Date(2026, 9, counter).toISOString(),
    readyAt: null,
    storage: null,
    runtimeMs: 1,
    mimeType: "video/mp4",
    ...over,
  };
}

const episode = (workId: string, season: number, ep: number, over: Partial<DownloadRecord> = {}) =>
  record({ workId, workKind: "series", title: `Episode ${ep}`, seriesTitle: "Show", seasonNumber: season, episodeNumber: ep, ...over });

describe("buildDownloadTree", () => {
  it("groups series, then season, then episode, sorted by number, and keeps movies flat", () => {
    const movie = record({ title: "A Film" });
    const tree = buildDownloadTree([episode("s1", 2, 1), movie, episode("s1", 1, 2), episode("s1", 1, 1), episode("s2", 1, 1, { seriesTitle: "Other" })]);
    expect(tree.map((item) => item.type)).toEqual(["series", "record", "series"]);
    const first = tree.find((item) => item.type === "series");
    if (!first || first.type !== "series") throw new Error("expected a series");
    expect(first.series.title).toBe("Show");
    expect(first.series.seasons.map((season) => season.seasonNumber)).toEqual([1, 2]);
    expect(first.series.seasons[0]?.episodes.map((node) => node.episodeNumber)).toEqual([1, 2]);
    expect(first.series.records).toHaveLength(3);
  });

  it("reads season and episode from an older record's subtitle", () => {
    const old = record({ workKind: "series", workId: "s9", title: "Pilot", subtitle: "Old Show · S03 · E07" });
    expect(episodeIdentity(old)).toEqual({ seriesTitle: "Old Show", seasonNumber: 3, episodeNumber: 7 });
    expect(buildDownloadTree([old])[0]?.type).toBe("series");
  });

  it("leaves a series record with no identity flat", () => {
    expect(buildDownloadTree([record({ workKind: "series", subtitle: "no numbers" })])[0]?.type).toBe("record");
  });
});

describe("aggregateDownloads", () => {
  it("sums progress and size and counts the states", () => {
    const aggregate = aggregateDownloads([
      record({ status: "downloading", bytesDownloaded: 250, totalBytes: 1000 }),
      record({ status: "paused", bytesDownloaded: 500, totalBytes: 1000 }),
      record({ status: "ready", bytesDownloaded: 0, totalBytes: 1000 }),
      record({ status: "failed", bytesDownloaded: 0, totalBytes: 1000 }),
    ]);
    expect(aggregate).toMatchObject({ count: 4, running: 1, paused: 1, ready: 1, failed: 1, bytesDownloaded: 1750, totalBytes: 4000, percent: 44 });
  });

  it("has no total while one is unknown", () => {
    const aggregate = aggregateDownloads([record({ status: "downloading", totalBytes: null, bytesDownloaded: 5 }), record({ status: "ready" })]);
    expect(aggregate.totalBytes).toBeNull();
    expect(aggregate.percent).toBeNull();
  });
});

describe("filterAndSortDownloads", () => {
  const items = [
    record({ workKind: "movie", status: "ready", title: "Zed", totalBytes: 5 }),
    record({ workKind: "series", status: "downloading", title: "Mid", seriesTitle: "Mid Show", totalBytes: 50 }),
    record({ workKind: "artist", status: "paused", title: "Alpha", totalBytes: 500 }),
    record({ workKind: "movie", status: "failed", title: "Bad", totalBytes: 1 }),
  ];

  it("filters by kind and by status", () => {
    expect(filterAndSortDownloads(items, { ...DEFAULT_DOWNLOAD_FILTERS, kind: "tv" })).toHaveLength(1);
    expect(filterAndSortDownloads(items, { ...DEFAULT_DOWNLOAD_FILTERS, kind: "music" })[0]?.title).toBe("Alpha");
    expect(filterAndSortDownloads(items, { ...DEFAULT_DOWNLOAD_FILTERS, status: "paused" })).toHaveLength(1);
    expect(filterAndSortDownloads(items, { ...DEFAULT_DOWNLOAD_FILTERS, status: "failed" })[0]?.title).toBe("Bad");
    expect(filterAndSortDownloads(items, { ...DEFAULT_DOWNLOAD_FILTERS, status: "downloading" })).toHaveLength(1);
    expect(filterAndSortDownloads(items, { ...DEFAULT_DOWNLOAD_FILTERS, status: "done" })[0]?.title).toBe("Zed");
  });

  it("sorts by recency, title and size", () => {
    expect(filterAndSortDownloads(items, DEFAULT_DOWNLOAD_FILTERS).map((r) => r.title)).toEqual(["Bad", "Alpha", "Mid", "Zed"]);
    expect(filterAndSortDownloads(items, { ...DEFAULT_DOWNLOAD_FILTERS, sort: "title" }).map((r) => r.title)).toEqual(["Alpha", "Bad", "Mid", "Zed"]);
    expect(filterAndSortDownloads(items, { ...DEFAULT_DOWNLOAD_FILTERS, sort: "size" }).map((r) => r.title)).toEqual(["Alpha", "Mid", "Zed", "Bad"]);
  });

  it("counts the active filters", () => {
    expect(activeFilterCount(DEFAULT_DOWNLOAD_FILTERS)).toBe(0);
    expect(activeFilterCount({ kind: "tv", status: "paused", sort: "size" })).toBe(3);
  });
});
