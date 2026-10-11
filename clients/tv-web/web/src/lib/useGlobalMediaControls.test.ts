import { describe, expect, it, vi } from "vitest";
import {
  globalMediaControlActionForKeystroke,
  installMediaSessionActionHandlers,
} from "./useGlobalMediaControls";

describe("Space and K on interactive targets", () => {
  it("leaves Space and K to a focused button, option or dialog", () => {
    expect(
      globalMediaControlActionForKeystroke({ key: " ", interactiveTarget: true })
    ).toBeNull();
    expect(
      globalMediaControlActionForKeystroke({ key: "k", interactiveTarget: true })
    ).toBeNull();
  });
  it("keeps hardware media keys global", () => {
    expect(
      globalMediaControlActionForKeystroke({
        key: "MediaPlayPause",
        interactiveTarget: true,
      })
    ).toBe("toggle-playback");
  });
});

describe("globalMediaControlActionForKeystroke", () => {
  it.each([
    ["MediaPlay", "play"],
    ["MediaPause", "pause"],
    ["MediaPlayPause", "toggle-playback"],
    ["MediaStop", "stop"],
    ["MediaRewind", "seek-backward"],
    ["MediaFastForward", "seek-forward"],
    ["MediaTrackPrevious", "previous-track"],
    ["MediaTrackNext", "next-track"],
  ] as const)("maps %s to %s", (key, action) => {
    expect(
      globalMediaControlActionForKeystroke({
        key,
        typingTarget: true,
      })
    ).toBe(action);
  });

  it("supports Space and K across every non-typing focus target", () => {
    expect(globalMediaControlActionForKeystroke({ key: " " })).toBe(
      "toggle-playback"
    );
    expect(globalMediaControlActionForKeystroke({ key: "k" })).toBe(
      "toggle-playback"
    );
  });

  it("does not steal shortcuts while typing, with modifiers, or when held", () => {
    expect(
      globalMediaControlActionForKeystroke({
        key: " ",
        typingTarget: true,
      })
    ).toBeNull();
    expect(
      globalMediaControlActionForKeystroke({ key: "k", ctrlKey: true })
    ).toBeNull();
    expect(
      globalMediaControlActionForKeystroke({
        key: "MediaTrackNext",
        repeat: true,
      })
    ).toBeNull();
  });
});

describe("installMediaSessionActionHandlers", () => {
  it("registers and removes browser playback actions", () => {
    const handlers = new Map<
      MediaSessionAction,
      MediaSessionActionHandler | null
    >();
    const mediaSession = {
      playbackState: "none" as MediaSessionPlaybackState,
      setActionHandler: vi.fn(
        (
          action: MediaSessionAction,
          handler: MediaSessionActionHandler | null
        ) => handlers.set(action, handler)
      ),
    };
    const callbacks = {
      onPlay: vi.fn(),
      onPause: vi.fn(),
      onTogglePlay: vi.fn(),
      onPrevious: vi.fn(),
      onNext: vi.fn(),
      onStop: vi.fn(),
      onSeekBackward: vi.fn(),
      onSeekForward: vi.fn(),
      onSeekTo: vi.fn(),
    };

    const removeHandlers = installMediaSessionActionHandlers(
      mediaSession,
      callbacks
    );

    handlers.get("play")?.({ action: "play" });
    handlers.get("pause")?.({ action: "pause" });
    handlers.get("previoustrack")?.({ action: "previoustrack" });
    handlers.get("nexttrack")?.({ action: "nexttrack" });
    expect(callbacks.onPlay).toHaveBeenCalledOnce();
    expect(callbacks.onPause).toHaveBeenCalledOnce();
    expect(callbacks.onPrevious).toHaveBeenCalledOnce();
    expect(callbacks.onNext).toHaveBeenCalledOnce();

    // The notification's seek buttons and scrubber.
    handlers.get("seekbackward")?.({ action: "seekbackward" });
    handlers.get("seekforward")?.({ action: "seekforward" });
    handlers.get("seekto")?.({ action: "seekto", seekTime: 42 });
    handlers.get("stop")?.({ action: "stop" });
    expect(callbacks.onSeekBackward).toHaveBeenCalledOnce();
    expect(callbacks.onSeekForward).toHaveBeenCalledOnce();
    expect(callbacks.onSeekTo).toHaveBeenCalledWith(42);
    expect(callbacks.onStop).toHaveBeenCalledOnce();

    removeHandlers();
    expect(Array.from(handlers.keys()).sort()).toEqual(
      ["nexttrack", "pause", "play", "previoustrack", "seekbackward", "seekforward", "seekto", "stop"]
    );
    expect(Array.from(handlers.values()).every((handler) => handler === null)).toBe(true);
  });
});
