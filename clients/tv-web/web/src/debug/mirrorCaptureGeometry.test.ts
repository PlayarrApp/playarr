import { describe, expect, it } from "vitest";
import { mirrorCaptureGeometry } from "./mirrorCaptureGeometry";

describe("debug mirror capture geometry", () => {
  it("removes only VIDAA's clone transform and captures the logical stage at the target size", () => {
    expect(mirrorCaptureGeometry(1280, 720, 2 / 3, 1280, true)).toEqual({
      width: 1920,
      height: 1080,
      pixelRatio: 2 / 3,
      cloneStyle: { transform: "none", width: "1920px", height: "1080px" },
    });
    expect(mirrorCaptureGeometry(1280, 720, 2 / 3, 1920, true)).toEqual({
      width: 1920,
      height: 1080,
      pixelRatio: 1,
      cloneStyle: { transform: "none", width: "1920px", height: "1080px" },
    });
  });

  it("preserves existing capture geometry for root-zoom and unscaled layouts", () => {
    expect(mirrorCaptureGeometry(1280, 720, 2 / 3, 1280, false)).toEqual({
      width: 1920,
      height: 1080,
      pixelRatio: 2 / 3,
    });
    expect(mirrorCaptureGeometry(1920, 1080, 1, 1280, false)).toEqual({
      width: 1920,
      height: 1080,
      pixelRatio: 2 / 3,
    });
  });
});
