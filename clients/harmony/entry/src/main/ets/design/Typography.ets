/**
 * Nunito Sans, the web design's font (OFL, bundled under rawfile/fonts). ArkUI has no variable-weight axis, so each weight
 * web uses is a static instance registered as its own family; `nunito(weight)` picks the family for an ArkUI weight.
 * Instances: 400 body, the exact web weights.
 */

import type { UIContext } from '@kit.ArkUI';

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
