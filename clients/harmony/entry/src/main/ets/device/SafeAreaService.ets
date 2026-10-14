/**
 * Phone safe area: the main window lays out edge to edge, and the notch or cutout, status bar and gesture bar insets are
 * published into AppStorage (vp) so pages place content with web's `max(base, inset)` (`core/SafeInsets.ts`).
 * Art and backgrounds run under the bars; text, headers and the nav bar stay inside. Re-read on every avoid-area or size change
 * (rotation moves the cutout from the top to a side).
 */

import { display, window } from '@kit.ArkUI';

import { mergeAvoidAreas } from '../core/SafeInsets.ts';
import type { AvoidThickness, SafeInsets } from '../core/SafeInsets.ts';
import { logError } from '../util/Log';

export const SAFE_TOP_KEY: string = 'safeTop';
export const SAFE_BOTTOM_KEY: string = 'safeBottom';
export const SAFE_LEFT_KEY: string = 'safeLeft';
export const SAFE_RIGHT_KEY: string = 'safeRight';

const LOG_TAG: string = 'SafeAreaService';

function thickness(area: window.AvoidArea): AvoidThickness {
  return {
    top: area.topRect.height,
    bottom: area.bottomRect.height,
    left: area.leftRect.width,
    right: area.rightRect.width,
  };
}

function publish(win: window.Window): void {
  const areas: AvoidThickness[] = [
    thickness(win.getWindowAvoidArea(window.AvoidAreaType.TYPE_CUTOUT)),
    thickness(win.getWindowAvoidArea(window.AvoidAreaType.TYPE_SYSTEM)),
    thickness(win.getWindowAvoidArea(window.AvoidAreaType.TYPE_NAVIGATION_INDICATOR)),
  ];
  const insets: SafeInsets = mergeAvoidAreas(areas, display.getDefaultDisplaySync().densityPixels);
  AppStorage.setOrCreate<number>(SAFE_TOP_KEY, insets.top);
  AppStorage.setOrCreate<number>(SAFE_BOTTOM_KEY, insets.bottom);
  AppStorage.setOrCreate<number>(SAFE_LEFT_KEY, insets.left);
  AppStorage.setOrCreate<number>(SAFE_RIGHT_KEY, insets.right);
}

export function installSafeAreaService(win: window.Window): void {
  try {
    win.setWindowLayoutFullScreen(true).then((): void => {
      try {
        publish(win);
      } catch (err) {
        logError(LOG_TAG, 'failed to read the avoid areas: ' + String(err));
      }
    }).catch((err: Error): void => {
      logError(LOG_TAG, 'failed to lay out edge to edge: ' + err.message);
    });
    const refresh = (): void => {
      try {
        publish(win);
      } catch (err) {
        logError(LOG_TAG, 'failed to refresh the avoid areas: ' + String(err));
      }
    };
    win.on('avoidAreaChange', refresh);
    win.on('windowSizeChange', refresh);
  } catch (err) {
    logError(LOG_TAG, 'failed to install the safe-area service: ' + String(err));
  }
}
