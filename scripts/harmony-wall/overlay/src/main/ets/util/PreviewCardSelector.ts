export interface PreviewCardGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
  measured: boolean;
  alive: boolean;
  visible: boolean;
}

/** Returns the first live, measured card intersecting the preview viewport. */
export function selectPreviewCard(cards: Array<PreviewCardGeometry>, tvMode: boolean): number {
  let best: number = -1;
  const minX: number = tvMode ? 500 : 0;
  const minY: number = tvMode ? 100 : 60;
  const viewportWidth: number = tvMode ? 1920 : 360;
  const maxY: number = tvMode ? 1000 : 780;
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    if (!card.alive || !card.visible || !card.measured || !Number.isFinite(card.x) ||
        !Number.isFinite(card.y) || !Number.isFinite(card.width) || !Number.isFinite(card.height) ||
        card.width <= 0 || card.height <= 0 || card.x >= viewportWidth ||
        card.x + card.width <= minX || card.y >= maxY || card.y + card.height <= minY) {
      continue;
    }
    if (best < 0 || card.y < cards[best].y - 20 ||
        (Math.abs(card.y - cards[best].y) <= 20 && card.x < cards[best].x)) {
      best = i;
    }
  }
  return best;
}
