import { describe, expect, it } from "vitest";
import { isLongHold, LONG_PRESS_MS } from "./longPress";

describe("isLongHold", () => {
  it("counts a hold of at least the long-press time, even if the timer did not run yet", () => {
    expect(isLongHold(1000, 1000 + LONG_PRESS_MS)).toBe(true);
    expect(isLongHold(1000, 1000 + 930)).toBe(true);
  });
  it("keeps a short press short and ignores a release with no recorded press", () => {
    expect(isLongHold(1000, 1000 + LONG_PRESS_MS - 1)).toBe(false);
    expect(isLongHold(undefined, 5000)).toBe(false);
  });
});
