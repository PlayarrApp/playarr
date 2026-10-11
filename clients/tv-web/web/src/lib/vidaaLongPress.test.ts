import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installVidaaLongPress } from "./vidaaLongPress";

// Node test environment: a minimal window that records the events the page would see after the capture-phase handlers.
type Ev = { type: string; key: string; keyCode: number; repeat: boolean; stopped: boolean; stopImmediatePropagation(): void; preventDefault(): void };
const mk = (type: string, repeat: boolean, init: Partial<Ev> = {}): Ev => ({
  type, key: "Enter", keyCode: 13, repeat, stopped: false, ...init,
  stopImmediatePropagation() { this.stopped = true; }, preventDefault() {},
});

describe("installVidaaLongPress", () => {
  let handlers: Record<string, ((e: Ev) => void)[]>;
  let seen: string[];
  let win: any;
  let off: () => void;
  const send = (e: Ev) => {
    for (const h of handlers[e.type] ?? []) h(e);
    if (!e.stopped) seen.push(`${e.type}${e.repeat ? "+rep" : ""}`);
  };
  beforeEach(() => {
    vi.useFakeTimers();
    handlers = {}; seen = [];
    const body = { dispatchEvent: (e: Ev) => send(e) };
    win = {
      addEventListener: (t: string, h: (e: Ev) => void) => (handlers[t] ??= []).push(h),
      removeEventListener: () => {},
      setTimeout: (f: () => void, ms: number) => setTimeout(f, ms),
      clearTimeout: (id: number) => clearTimeout(id),
      document: { activeElement: null, body },
      KeyboardEvent: class { constructor(public type: string, init: Partial<Ev>) { return mk(type, false, init) as any; } },
    };
    off = installVidaaLongPress(win, 900);
  });
  afterEach(() => { off(); vi.useRealTimers(); });

  it("turns an instant repeat burst into a plain keydown and a keyup after the hold", () => {
    for (let i = 0; i < 3; i++) send(mk("keydown", true));
    send(mk("keyup", false));
    expect(seen).toEqual(["keydown"]);
    vi.advanceTimersByTime(899);
    expect(seen).toEqual(["keydown"]);
    vi.advanceTimersByTime(2);
    expect(seen).toEqual(["keydown", "keyup"]);
  });

  it("keeps holding when more repeats of the burst arrive after the synthetic keydown", () => {
    send(mk("keydown", true));
    send(mk("keydown", true));
    send(mk("keydown", true));
    expect(seen).toEqual(["keydown"]);
  });

  it("also handles a burst that starts with a plain keydown", () => {
    send(mk("keydown", false));
    send(mk("keydown", true));
    send(mk("keydown", true));
    send(mk("keyup", false));
    expect(seen).toEqual(["keydown", "keydown"]); // the original plain keydown, then our fresh one that restarts the page's timer
    vi.advanceTimersByTime(901);
    expect(seen).toEqual(["keydown", "keydown", "keyup"]);
  });

  it("leaves a normal press and a real held key (repeats start 500 ms after the keydown) alone", () => {
    send(mk("keydown", false));
    vi.advanceTimersByTime(500);
    send(mk("keydown", true));
    send(mk("keyup", false));
    expect(seen).toEqual(["keydown", "keydown+rep", "keyup"]);
  });
});
