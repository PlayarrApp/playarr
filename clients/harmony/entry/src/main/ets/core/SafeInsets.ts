/**
 * Phone safe-area insets (web `max(base, inset)` rule): the notch or cutout, the status bar and the gesture bar, in vp.
 * Pure, so it is unit-tested with injected insets (the Previewer reports none).
 */

/** One ArkUI avoid area, each rect reduced to its thickness in px (0 when absent). */
export interface AvoidThickness {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface SafeInsets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export const NO_INSETS: SafeInsets = { top: 0, bottom: 0, left: 0, right: 0 };

/** The widest inset on each side across the cutout, system bar and navigation indicator areas, px to vp. */
export function mergeAvoidAreas(areas: AvoidThickness[], densityPixels: number): SafeInsets {
  const d = densityPixels > 0 ? densityPixels : 1;
  const side = (pick: (a: AvoidThickness) => number): number => Math.max(0, ...areas.map(pick)) / d;
  return { top: side((a) => a.top), bottom: side((a) => a.bottom), left: side((a) => a.left), right: side((a) => a.right) };
}

/** web `max(base, inset)`. */
export function atLeast(base: number, inset: number): number {
  return Math.max(base, inset);
}
