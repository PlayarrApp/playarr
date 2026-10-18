/** The phone header's round icon button (web phone page actions: the bell, the filter button), 43 px. */

import { activeColors, tintFilter, toResourceColorWithAlpha } from '../Theme';
import type { ThemeModeSetting } from '../Theme';

@Component
export struct TouchIconButton {
  icon: ResourceStr = '';
  onTap: () => void = () => {};

  @StorageProp('colorMode') private sysColorMode: ColorMode = ColorMode.LIGHT;
  @StorageProp('themeModeSetting') private themeSetting: ThemeModeSetting = 'system';

  build() {
    Image(this.icon)
      .colorFilter(tintFilter(activeColors().inkSoft))
      .padding(12)
      .width(43)
      .height(43)
      .margin({ bottom: 4.6 }) // web sits this button 2.3 vp above the Back circle's centre
      .borderRadius(13)
      .backgroundColor(toResourceColorWithAlpha(activeColors().surfaceStrong, 0.7))
      .border({ width: 1, color: toResourceColorWithAlpha(activeColors().ink, 0.08) })
      // web .action-pill: 0 14 36 rgba(56, 38, 33, 0.08)
      .shadow({ radius: 36, offsetX: 0, offsetY: 14, color: 'rgba(56, 38, 33, 0.08)' })
      .onClick(() => {
        this.onTap();
      })
  }
}
