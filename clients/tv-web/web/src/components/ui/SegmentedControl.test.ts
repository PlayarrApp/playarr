import { describe, expect, it } from "vitest";
import { nearestSegmentInNeighbourRow } from "./SegmentedControl";

// Settings > Appearance: theme (3 segments), Home artwork (2), artwork size (3).
const rows = [
  [769, 1124, 1474],
  [1032, 1558],
  [774, 1120, 1474],
];

describe("nearestSegmentInNeighbourRow", () => {
  it("steps down to the next row, not past it, even when a later row lines up better", () => {
    expect(nearestSegmentInNeighbourRow(rows, 0, 945, 1)).toEqual({ row: 1, segment: 0 });
    expect(nearestSegmentInNeighbourRow(rows, 1, 1032, 1)).toEqual({ row: 2, segment: 1 });
  });

  it("steps up the same way and picks the nearest segment by centre", () => {
    expect(nearestSegmentInNeighbourRow(rows, 2, 1474, -1)).toEqual({ row: 1, segment: 1 });
  });

  it("returns null at the first and last row so focus can leave", () => {
    expect(nearestSegmentInNeighbourRow(rows, 0, 945, -1)).toBeNull();
    expect(nearestSegmentInNeighbourRow(rows, 2, 945, 1)).toBeNull();
  });
});
