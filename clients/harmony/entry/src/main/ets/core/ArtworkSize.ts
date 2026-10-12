// core/ArtworkSize.ts: web `lib/artworkSize.tsx` + `styles/page-layout.css` `--card-w` / `--card-w-cover`, evaluated at the
// 1920 px TV stage. Small shifts every column count by +1, large by -1; a poster card is the rail width less its padding
// and gaps, split into that many columns. Callers scale the result with tv().

export type ArtworkSizeName = "small" | "medium" | "large";

export function normaliseArtworkSize(raw: string): ArtworkSizeName {
  return raw === "small" || raw === "large" ? raw : "medium";
}

export function artworkStep(size: ArtworkSizeName): number {
  return size === "small" ? 1 : size === "large" ? -1 : 0;
}

// 1920 px stage (--vw 19.2 px): rail 62 vw, left pad 2.8 vw clamped to 54, right pad 12.48 + 62 + 28.8.
const RAIL_SPACE: number = 1190.4 - 53.76 - 103.28;
const GAP_LANDSCAPE: number = 25.92;
const GAP_COVER: number = 19.2;

export interface CardGeometry {
  columns: number;
  width: number;
  height: number;
  gap: number;
}

/** The card the Library grid and Home rails use: landscape 16:9 (`cover` false) or portrait 2:3 (`cover` true). */
export function cardGeometry(cover: boolean, size: ArtworkSizeName): CardGeometry {
  const columns = (cover ? 5 : 3) + artworkStep(size);
  const gap = cover ? GAP_COVER : GAP_LANDSCAPE;
  const width = (RAIL_SPACE - (columns - 1) * gap) / columns;
  return { columns: columns, width: width, height: cover ? width * 1.5 : (width * 9) / 16, gap: gap };
}
