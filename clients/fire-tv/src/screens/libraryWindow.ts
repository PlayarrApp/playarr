export interface LibraryWindowOptions {
  itemCount: number;
  columns: number;
  rowPitch: number;
  cardTop: number;
  cardExtent: number;
  viewportTop: number;
  viewportBottom: number;
  offsets: readonly number[];
  overscanRows?: number;
}

export interface LibraryWindow {
  startIndex: number;
  endIndex: number;
}

/** Return the item slice covering viewport-intersecting rows at every supplied scroll offset. */
export function computeLibraryWindow({
  itemCount,
  columns,
  rowPitch,
  cardTop,
  cardExtent,
  viewportTop,
  viewportBottom,
  offsets,
  overscanRows = 1,
}: LibraryWindowOptions): LibraryWindow {
  const count = Math.max(0, Math.floor(itemCount));
  const cols = Math.max(1, Math.floor(columns));
  const rowCount = Math.ceil(count / cols);
  if (rowCount === 0 || rowPitch <= 0 || viewportBottom <= viewportTop) {
    return {startIndex: 0, endIndex: 0};
  }

  let firstRow = rowCount;
  let endRow = 0;
  for (const rawOffset of offsets.length > 0 ? offsets : [0]) {
    const offset = Math.max(0, rawOffset);
    const firstIntersecting = Math.max(0, Math.floor((viewportTop + offset - cardTop - cardExtent) / rowPitch) + 1);
    const endIntersecting = Math.min(rowCount, Math.ceil((viewportBottom + offset - cardTop) / rowPitch));
    if (firstIntersecting < endIntersecting) {
      firstRow = Math.min(firstRow, firstIntersecting);
      endRow = Math.max(endRow, endIntersecting);
    }
  }

  if (firstRow === rowCount) return {startIndex: 0, endIndex: Math.min(count, cols)};

  const overscan = Math.max(0, Math.floor(overscanRows));
  const startRow = Math.max(0, firstRow - overscan);
  const boundedEndRow = Math.min(rowCount, endRow + overscan);
  return {
    startIndex: startRow * cols,
    endIndex: Math.min(count, boundedEndRow * cols),
  };
}

/** Keep the existing smooth-scroll target rule in one place for render and effect use. */
export function nextLibraryScrollOffset(currentOffset: number, row: number, rowPitch: number, cardExtent: number, gridTop: number): number {
  const cardTop = gridTop + row * rowPitch - currentOffset;
  const cardBottom = cardTop + cardExtent;
  let next = currentOffset;
  if (cardBottom > 1036.5) next += cardBottom - 1036.5;
  else if (cardTop < 33.5) next -= 33.5 - cardTop;
  return Math.max(0, next);
}
