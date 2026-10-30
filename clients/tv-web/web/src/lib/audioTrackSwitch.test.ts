import { describe, expect, it } from "vitest";
import {
  audioSwitchRequest,
  nativeAudioTracksFor,
  shouldExposeSourceAudioTracks,
  switchNativeAudioTrack,
} from "./audioTrackSwitch";

const tracks = [{ id: "a1" }, { id: "a2" }];

describe("audio list exposure", () => {
  it("lists 2+ tracks in direct play", () => {
    expect(shouldExposeSourceAudioTracks({ kind: "ready", mode: "direct" }, 2)).toBe(true);
    expect(shouldExposeSourceAudioTracks({ kind: "ready", mode: "direct" }, 1)).toBe(false);
  });

  it("lists tracks in any other mode and keeps the HLS behaviour", () => {
    expect(shouldExposeSourceAudioTracks({ kind: "ready", mode: "hls" }, 1)).toBe(true);
    expect(shouldExposeSourceAudioTracks({ kind: "ready", mode: "hls" }, 0)).toBe(false);
    expect(shouldExposeSourceAudioTracks({ kind: "ready", mode: "remux" }, 3)).toBe(true);
  });

  it("lists nothing until negotiation is ready", () => {
    expect(shouldExposeSourceAudioTracks({ kind: "loading" }, 3)).toBe(false);
  });
});

describe("native audioTracks path", () => {
  const list = () => [{ enabled: true }, { enabled: false }];

  it("is used only in direct mode with one entry per source track", () => {
    const native = list();
    expect(nativeAudioTracksFor({ audioTracks: native }, "direct", 2)).toBe(native);
    expect(nativeAudioTracksFor({ audioTracks: native }, "hls", 2)).toBeNull();
    expect(nativeAudioTracksFor({ audioTracks: native }, "direct", 3)).toBeNull();
  });

  it("falls back when the browser has no audioTracks", () => {
    expect(nativeAudioTracksFor({}, "direct", 2)).toBeNull();
    expect(nativeAudioTracksFor(null, "direct", 2)).toBeNull();
  });

  it("enables only the picked track", () => {
    const native = list();
    expect(switchNativeAudioTrack(native, tracks, "a2")).toBe(true);
    expect(native.map((track) => track.enabled)).toEqual([false, true]);
  });

  it("leaves the list alone for an unknown id", () => {
    const native = list();
    expect(switchNativeAudioTrack(native, tracks, "zz")).toBe(false);
    expect(native.map((track) => track.enabled)).toEqual([true, false]);
  });
});

describe("renegotiate path", () => {
  it("keeps the request, resumes at the position and adds audioStreamIndex", () => {
    const base = { supportedCodecs: ["h264"], subtitleStreamIndex: 4 };
    expect(audioSwitchRequest(base, 12.3456, 2)).toEqual({
      supportedCodecs: ["h264"],
      subtitleStreamIndex: 4,
      startPositionMs: 12346,
      audioStreamIndex: 2,
    });
    expect(base).not.toHaveProperty("audioStreamIndex");
  });

  it("never asks for a negative position", () => {
    expect(audioSwitchRequest({}, -3, 1).startPositionMs).toBe(0);
  });
});
