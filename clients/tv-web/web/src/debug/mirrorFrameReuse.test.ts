import { describe, expect, it } from "vitest";
import { REFRESH_AFTER_MS, hashString, newReuseState, recordRender, canReuseImage } from "./mirrorFrameReuse";

describe("mirror frame reuse", () => {
  it("renders a new state twice before it is reused", () => {
    const s = newReuseState();
    expect(canReuseImage(s, "a", 0)).toBe(false);
    recordRender(s, "a", true, 0);
    expect(canReuseImage(s, "a", 10)).toBe(false);
    recordRender(s, "a", true, 20);
    expect(canReuseImage(s, "a", 30)).toBe(true);
  });

  it("renders again when the state changes", () => {
    const s = newReuseState();
    recordRender(s, "a", true, 0);
    recordRender(s, "a", true, 1);
    expect(canReuseImage(s, "b", 2)).toBe(false);
    recordRender(s, "b", true, 3);
    expect(canReuseImage(s, "b", 4)).toBe(false);
  });

  it("refreshes after the insurance interval and forgets failed renders", () => {
    const s = newReuseState();
    recordRender(s, "a", true, 0);
    recordRender(s, "a", true, 0);
    expect(canReuseImage(s, "a", REFRESH_AFTER_MS - 1)).toBe(true);
    expect(canReuseImage(s, "a", REFRESH_AFTER_MS)).toBe(false);
    recordRender(s, "a", false, 5);
    expect(canReuseImage(s, "a", 6)).toBe(false);
  });

  it("hashes deterministically", () => {
    expect(hashString("abc")).toBe(hashString("abc"));
    expect(hashString("abc")).not.toBe(hashString("abd"));
  });
});
