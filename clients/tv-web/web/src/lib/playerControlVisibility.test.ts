import { describe, expect, it } from "vitest";
import {
  shouldAutoHidePlayerControls,
  shouldRenderPlayerControls,
} from "./playerControlVisibility";

describe("shouldAutoHidePlayerControls", () => {
  it("keeps inline music controls visible during playback", () => {
    expect(
      shouldAutoHidePlayerControls({
        inlineMusic: true,
        minimised: true,
        playbackState: "playing",
        interactionPinned: false,
      })
    ).toBe(false);
  });

  it("auto-hides unpinned fullscreen controls during playback", () => {
    expect(
      shouldAutoHidePlayerControls({
        inlineMusic: false,
        minimised: false,
        playbackState: "playing",
        interactionPinned: false,
      })
    ).toBe(true);
  });

  it("keeps inline controls rendered while playback is busy or not yet started", () => {
    expect(shouldRenderPlayerControls({ inlineMusic: true, minimised: true })).toBe(true);
  });

  it("renders fullscreen controls and not those of a minimised non-music player", () => {
    expect(shouldRenderPlayerControls({ inlineMusic: false, minimised: false })).toBe(true);
    expect(shouldRenderPlayerControls({ inlineMusic: false, minimised: true })).toBe(false);
  });
});
