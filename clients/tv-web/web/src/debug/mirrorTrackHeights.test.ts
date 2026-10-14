import { expect, it } from "vitest";
import { withCollapsingTrackHeights } from "./mirrorTrackHeights";

// No DOM in this environment: stand in a minimal window and element so the wrapper's behaviour is testable.
class FakeElement {
  constructor(private readonly selectorMatches: boolean, private readonly height: string) {}
  matches(): boolean {
    return this.selectorMatches;
  }
  style() {
    return { cssText: `color: red; height: ${this.height}; width: 5px;`, getPropertyValue: (n: string) => (n === "height" ? this.height : "x") };
  }
}

it("reports auto height for track wrappers during a capture only, and restores getComputedStyle", async () => {
  const g = globalThis as unknown as Record<string, unknown>;
  const original = (el: FakeElement) => el.style();
  g.Element = FakeElement;
  g.window = { getComputedStyle: original };
  const win = g.window as { getComputedStyle: (el: FakeElement, p?: string | null) => ReturnType<FakeElement["style"]> };
  const track = new FakeElement(true, "376px");
  const other = new FakeElement(false, "50px");
  let inside = "";
  let insideCss = "";
  let insideOther = "";
  await withCollapsingTrackHeights(async () => {
    inside = win.getComputedStyle(track).getPropertyValue("height");
    insideCss = win.getComputedStyle(track).cssText;
    insideOther = win.getComputedStyle(other).getPropertyValue("height");
  });
  expect(inside).toBe("auto");
  expect(insideCss).not.toContain("height");
  expect(insideOther).toBe("50px");
  expect(win.getComputedStyle).toBe(original);
  expect(win.getComputedStyle(track).getPropertyValue("height")).toBe("376px");
  delete g.Element;
  delete g.window;
});
