import { afterEach, describe, expect, it, vi } from "vitest";
import { centreTrackInStack } from "./RailStack";

// Node environment (no jsdom): the stack, the track, the resize observer and the window are small fakes.
type Callback = () => void;
const observers: Callback[] = [];
const windowListeners = new Map<string, Set<() => void>>();

class FakeResizeObserver {
  constructor(callback: Callback) {
    observers.push(callback);
  }
  observe(): void {}
  disconnect(): void {}
}

function build(trackHeight: { value: number }) {
  const stack = {
    scrollTop: 0,
    clientHeight: 1000,
    scrollHeight: 5000,
    style: { setProperty: () => undefined, removeProperty: () => undefined },
    getBoundingClientRect: () => ({ top: 0 }),
  };
  const track = {
    closest: () => stack,
    getBoundingClientRect: () => ({ top: 500 - stack.scrollTop, height: trackHeight.value }),
  };
  return { stack, track: track as unknown as HTMLElement };
}

afterEach(() => {
  vi.unstubAllGlobals();
  observers.length = 0;
  windowListeners.clear();
});

describe("centreTrackInStack settling", () => {
  it("does not watch an animated centre (a glide between rails)", () => {
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    vi.stubGlobal("window", { setTimeout: () => 1, clearTimeout: () => undefined, addEventListener: () => undefined, removeEventListener: () => undefined, cancelAnimationFrame: () => undefined, requestAnimationFrame: () => 1 });
    const { track } = build({ value: 300 });
    centreTrackInStack(track);
    expect(observers.length).toBe(0);
  });

  it("re-centres the track when its height changes shortly after the first centring, and not after a key", () => {
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    vi.stubGlobal("window", {
      setTimeout: () => 1,
      clearTimeout: () => undefined,
      addEventListener: (type: string, fn: () => void) => windowListeners.set(type, (windowListeners.get(type) ?? new Set()).add(fn)),
      removeEventListener: (type: string, fn: () => void) => windowListeners.get(type)?.delete(fn),
      cancelAnimationFrame: () => undefined,
    });
    const height = { value: 300 };
    const { stack, track } = build(height);
    // The fake stack is the closest ancestor for any selector.
    centreTrackInStack(track, { animate: false });
    expect(stack.scrollTop).toBe(150); // track centre 650 - half of 1000

    height.value = 352; // posters loaded: the track grew by 52 px
    observers.at(-1)!();
    expect(stack.scrollTop).toBe(176);

    for (const fn of [...(windowListeners.get("keydown") ?? [])]) fn(); // a key ends the watch
    height.value = 400;
    observers.at(-1)!();
    expect(stack.scrollTop).toBe(176);
  });
});
