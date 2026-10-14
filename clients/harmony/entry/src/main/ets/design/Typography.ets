/**
 * Nunito Sans, the web design's font (OFL, bundled under rawfile/fonts). ArkUI has no variable-weight axis, so each weight
 * web uses is a static instance registered as its own family; `nunito(weight)` picks the family for an ArkUI weight.
 * Instances: 400 body, 580 headings (web 560), 610 labels and copy (web 600), 700 bold, 820 heavy (web 860).
 */

import type { UIContext } from '@kit.ArkUI';

const FAMILY_400: string = 'NunitoSans400';
const FAMILY_580: string = 'NunitoSans580';
const FAMILY_610: string = 'NunitoSans610';
const FAMILY_700: string = 'NunitoSans700';
const FAMILY_820: string = 'NunitoSans820';

/** Registers every family once; call it before the first Text is laid out (the root page's `aboutToAppear`). */
export function registerNunito(ui: UIContext): void {
  const font = ui.getFont();
  font.registerFont({ familyName: FAMILY_400, familySrc: $rawfile('fonts/NunitoSans-400.ttf') });
  font.registerFont({ familyName: FAMILY_580, familySrc: $rawfile('fonts/NunitoSans-580.ttf') });
  font.registerFont({ familyName: FAMILY_610, familySrc: $rawfile('fonts/NunitoSans-610.ttf') });
  font.registerFont({ familyName: FAMILY_700, familySrc: $rawfile('fonts/NunitoSans-700.ttf') });
  font.registerFont({ familyName: FAMILY_820, familySrc: $rawfile('fonts/NunitoSans-820.ttf') });
}

/** The family for a numeric ArkUI weight (100..900): light and regular 400, 500 headings, 600 labels, 700 bold, 800+ heavy. */
export function nunito(weight: number): string {
  if (weight >= 800) {
    return FAMILY_820;
  }
  if (weight >= 700) {
    return FAMILY_700;
  }
  if (weight >= 600) {
    return FAMILY_610;
  }
  if (weight >= 500) {
    return FAMILY_580;
  }
  return FAMILY_400;
}
