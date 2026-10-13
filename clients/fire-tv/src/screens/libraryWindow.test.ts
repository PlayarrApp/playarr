import {computeLibraryWindow, nextLibraryScrollOffset} from './libraryWindow';

describe('computeLibraryWindow', () => {
  const base = {
    itemCount: 90,
    columns: 3,
    rowPitch: 240.4,
    cardTop: 155,
    cardExtent: 217,
    viewportTop: 0,
    viewportBottom: 1080,
    offsets: [0],
  };

  it('includes rows whose cards intersect the full viewport and one row of overscan', () => {
    expect(computeLibraryWindow(base)).toEqual({startIndex: 0, endIndex: 15});
  });

  it('excludes a row that only touches the viewport edge', () => {
    const window = computeLibraryWindow({
      ...base,
      itemCount: 30,
      columns: 1,
      rowPitch: 100,
      cardTop: 0,
      cardExtent: 100,
      viewportTop: 0,
      viewportBottom: 200,
      overscanRows: 0,
    });
    expect(window).toEqual({startIndex: 0, endIndex: 2});
  });

  it('retains rows 2 and 3 visible at the measured medium-layout offset', () => {
    const window = computeLibraryWindow({...base, offsets: [778]});

    expect(window.startIndex).toBe(3);
    expect(window.endIndex).toBeGreaterThanOrEqual(12);
  });

  it('keeps the union of rows needed at the live and target animation offsets', () => {
    const settledOrCurrent = computeLibraryWindow({...base, offsets: [700]});
    const previousTarget = computeLibraryWindow({...base, offsets: [1000]});
    const newReverseTarget = computeLibraryWindow({...base, offsets: [300]});
    const interruptedUnion = computeLibraryWindow({...base, offsets: [700, 1000, 300]});

    expect(interruptedUnion.startIndex).toBe(Math.min(settledOrCurrent.startIndex, previousTarget.startIndex, newReverseTarget.startIndex));
    expect(interruptedUnion.endIndex).toBe(Math.max(settledOrCurrent.endIndex, previousTarget.endIndex, newReverseTarget.endIndex));
    expect(interruptedUnion).toEqual({startIndex: 0, endIndex: 30});
    expect(interruptedUnion.endIndex - interruptedUnion.startIndex).toBeLessThan(base.itemCount);
  });
});

describe('nextLibraryScrollOffset', () => {
  it('preserves the established focused-card thresholds and clamps at the start', () => {
    expect(nextLibraryScrollOffset(0, 0, 240.4, 217, 155)).toBe(0);
    expect(nextLibraryScrollOffset(0, 5, 240.4, 217, 155)).toBeCloseTo(537.5);
  });
});
