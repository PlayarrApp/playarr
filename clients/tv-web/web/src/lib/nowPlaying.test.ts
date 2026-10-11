import { describe, expect, it } from "vitest";
import { nowPlayingMetadataInit, nowPlayingPositionState } from "./nowPlaying";

describe("nowPlayingMetadataInit", () => {
  it("carries title, artist, album and the artwork for the notification", () => {
    expect(
      nowPlayingMetadataInit({ title: "Track", artist: "Artist", album: "Album", artworkUrl: "blob:art" })
    ).toEqual({ title: "Track", artist: "Artist", album: "Album", artwork: [{ src: "blob:art", sizes: "512x512" }] });
  });

  it("omits artwork until it has loaded", () => {
    expect(nowPlayingMetadataInit({ title: "Film", artworkUrl: null }).artwork).toEqual([]);
  });
});

describe("nowPlayingPositionState", () => {
  it("clamps the position inside the duration", () => {
    expect(nowPlayingPositionState(130, 120)).toEqual({ duration: 120, position: 120, playbackRate: 1 });
    expect(nowPlayingPositionState(-3, 120)).toEqual({ duration: 120, position: 0, playbackRate: 1 });
  });

  it("is null while the duration is unknown or infinite (the browser would throw)", () => {
    expect(nowPlayingPositionState(5, 0)).toBeNull();
    expect(nowPlayingPositionState(5, Number.NaN)).toBeNull();
    expect(nowPlayingPositionState(5, Number.POSITIVE_INFINITY)).toBeNull();
  });
});
