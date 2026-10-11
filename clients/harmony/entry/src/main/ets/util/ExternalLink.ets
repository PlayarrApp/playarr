/**
 * Opens a web address in the system browser (web's "Clients" link goes to the downloads page of every client).
 * HarmonyOS opens a browsable address with an implicit want: the system picks the browser. Never throws: a failure is
 * logged and nothing happens. Not verified on a device (written without one).
 */

import { common, Want } from '@kit.AbilityKit';

import { logWarn } from './Log';

const LOG_TAG: string = 'ExternalLink';

export function openInBrowser(context: common.Context, url: string): void {
  const want: Want = {
    action: 'ohos.want.action.viewData',
    entities: ['entity.system.browsable'],
    uri: url,
  };
  try {
    (context as common.UIAbilityContext).startAbility(want).catch((err: Error): void => {
      logWarn(LOG_TAG, 'could not open the browser: ' + err.message);
    });
  } catch (err) {
    logWarn(LOG_TAG, 'could not open the browser: ' + (err as Error).message);
  }
}
