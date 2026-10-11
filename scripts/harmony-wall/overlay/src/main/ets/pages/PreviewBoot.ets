// Preview-only harness (never committed to the app): the DevEco Previewer does not run EntryAbility,
// so this page does what onWindowStageCreate does, pins the TV profile (1920x1080 vp) and dark theme,
// then hands over to pages/Index.
import { router, window } from '@kit.ArkUI';
import { common } from '@kit.AbilityKit';
import { bootstrapAppContainer } from '../AppContainer';
import { DEVICE_PROFILE_STORAGE_KEY, TV_STAGE_SCALE_STORAGE_KEY } from '../device/DeviceProfileService';
import { DeviceProfile, resolveProfile } from '../core/DeviceProfile';
import { setThemeModeSetting } from '../design/Theme';
import { initSandbox } from '../util/Sandbox';
import { preferences } from '@kit.ArkData';
import { asset } from '@kit.AssetStoreKit';

@Entry
@Component
struct PreviewBoot {
  @State private status: string = 'booting';

  aboutToAppear(): void {
    const profile: DeviceProfile = resolveProfile('tv', 1920, 1080);
    AppStorage.setOrCreate<DeviceProfile>(DEVICE_PROFILE_STORAGE_KEY, profile);
    AppStorage.setOrCreate<number>(TV_STAGE_SCALE_STORAGE_KEY, 1);
    setThemeModeSetting('dark');
    const context: common.Context = getContext(this) as common.Context;
    try {
      initSandbox(context);
    } catch (err) {
      console.error('PreviewBoot sandbox: ' + String(err));
    }
    preferences.getPreferences(context, 'probe').then((): void => { console.info('PROBE prefs ok'); })
      .catch((e: Error): void => { console.error('PROBE prefs fail ' + e.message); });
    const q: asset.AssetMap = new Map();
    asset.query(q).then((): void => { console.info('PROBE asset ok'); })
      .catch((e: Error): void => { console.error('PROBE asset fail ' + e.message + ' ' + JSON.stringify(e)); });
    const stage: window.WindowStage = new Object() as window.WindowStage;
    bootstrapAppContainer(context, stage).then((): void => {
      this.status = 'boot ok';
      setTimeout((): void => { router.replaceUrl({ url: 'pages/Index' }); }, 4000);
    }).catch((err: Error): void => {
      this.status = 'bootstrap failed: ' + err.message;
      console.error('PreviewBoot ' + this.status);
    });
  }

  build() {
    Column() {
      Text(this.status).fontColor(Color.White).fontSize(64)
    }.width('100%').height('100%').backgroundColor('#141218')
  }
}
