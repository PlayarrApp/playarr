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

/** The family for a weight: an exact web weight (WEIGHTS) names its static instance; the nominal ArkUI weights keep their old picks
 * (500 headings 580, 600 labels 610, 800+ heavy 820, below 500 regular 400). */
export function nunito(weight: number): string {
  if (WEIGHTS.indexOf(weight) >= 0) {
    return 'NunitoSansW' + weight.toString();
  }
  if (weight >= 800) {
    return 'NunitoSansW820';
  }
  if (weight >= 700) {
    return 'NunitoSansW700';
  }
  if (weight >= 600) {
    return 'NunitoSansW610';
  }
  if (weight >= 500) {
    return 'NunitoSansW580';
  }
  return 'NunitoSansW400';
}
