/**
 * Nunito Sans, the web design's font (OFL, bundled under rawfile/fonts). ArkUI has no variable-weight axis, so each weight
 * web uses is a static instance registered as its own family; `nunito(weight)` picks the family for an ArkUI weight.
 * Instances: 400 body, the exact web weights.
 */

import type { UIContext } from '@kit.ArkUI';
import { WEB_SIZES, WEB_WEIGHTS } from '../core/WebWeights';

const WEIGHTS: number[] = [300, 400, 480, 560, 580, 610, 640, 680, 700, 720, 760, 820, 860, 900];

/** Registers every family once; call it before the first Text is laid out (the root page's `aboutToAppear`). */
export function registerNunito(ui: UIContext): void {
  const font = ui.getFont();
  font.registerFont({ familyName: 'NunitoSansW300', familySrc: $rawfile('fonts/NunitoSans-W300.ttf') });
  font.registerFont({ familyName: 'NunitoSansW400', familySrc: $rawfile('fonts/NunitoSans-W400.ttf') });
  font.registerFont({ familyName: 'NunitoSansW480', familySrc: $rawfile('fonts/NunitoSans-W480.ttf') });
  font.registerFont({ familyName: 'NunitoSansW560', familySrc: $rawfile('fonts/NunitoSans-W560.ttf') });
  font.registerFont({ familyName: 'NunitoSansW580', familySrc: $rawfile('fonts/NunitoSans-W580.ttf') });
  font.registerFont({ familyName: 'NunitoSansW610', familySrc: $rawfile('fonts/NunitoSans-W610.ttf') });
  font.registerFont({ familyName: 'NunitoSansW640', familySrc: $rawfile('fonts/NunitoSans-W640.ttf') });
  font.registerFont({ familyName: 'NunitoSansW680', familySrc: $rawfile('fonts/NunitoSans-W680.ttf') });
  font.registerFont({ familyName: 'NunitoSansW700', familySrc: $rawfile('fonts/NunitoSans-W700.ttf') });
  font.registerFont({ familyName: 'NunitoSansW720', familySrc: $rawfile('fonts/NunitoSans-W720.ttf') });
  font.registerFont({ familyName: 'NunitoSansW760', familySrc: $rawfile('fonts/NunitoSans-W760.ttf') });
  font.registerFont({ familyName: 'NunitoSansW820', familySrc: $rawfile('fonts/NunitoSans-W820.ttf') });
  font.registerFont({ familyName: 'NunitoSansW860', familySrc: $rawfile('fonts/NunitoSans-W860.ttf') });
  font.registerFont({ familyName: 'NunitoSansW900', familySrc: $rawfile('fonts/NunitoSans-W900.ttf') });
  font.registerFont({ familyName: 'PlayarrArrows', familySrc: $rawfile('fonts/PlayarrArrows.ttf') });
  font.registerFont({ familyName: 'PlayarrArrowsRegular', familySrc: $rawfile('fonts/PlayarrArrowsRegular.ttf') });
}

/** The family for a weight: the nearest static instance. Call sites pass the web CSS weight; the nominal ArkUI weights
 * (500, 600, 800) land on the nearest web instance. */
export function nunito(weight: number): string {
  let best: number = WEIGHTS[0];
  for (const w of WEIGHTS) {
    if (Math.abs(w - weight) < Math.abs(best - weight)) {
      best = w;
    }
  }
  return 'NunitoSansW' + best.toString();
}

/** Web draws the arrow glyphs (U+2190, U+2192) with Chromium's fallback, Liberation Sans (bold from weight 600 up); the subsets bundled here carry the same glyphs. */
export function arrowFont(weight: number): string {
  // Nunito first: its metrics set the line, as a browser's primary font does; it has no arrow glyphs, so those come from the subset.
  return nunito(weight) + ',' + (weight >= 600 ? 'PlayarrArrows' : 'PlayarrArrowsRegular');
}

/** The family for a call site that asks for `weight` at font size `size`: the web weight nearest to it among those web CSS uses
 * at that size (core/WebWeights.ts, generated from the web layout refs), else the nearest instance. */
export function nunitoAt(weight: number, size: number): string {
  const key: number = Math.round(size * 100) / 100;
  const at: number = WEB_SIZES.indexOf(key);
  if (at >= 0) {
    const row: number[] = WEB_WEIGHTS[at];
    let best: number = row[0];
    for (const w of row) {
      if (Math.abs(w - weight) < Math.abs(best - weight)) {
        best = w;
      }
    }
    return nunito(best);
  }
  return nunito(weight);
}
