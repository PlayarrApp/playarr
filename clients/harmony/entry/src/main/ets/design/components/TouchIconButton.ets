/** The phone header's round icon button (web phone page actions: the bell, the filter button), 40 px. */

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
      .padding(10)
      .width(40)
      .height(40)
      .borderRadius(20)
      .backgroundColor(toResourceColorWithAlpha(activeColors().surfaceStrong, 0.7))
      .border({ width: 1, color: toResourceColorWithAlpha(activeColors().ink, 0.08) })
      .onClick(() => {
        this.onTap();
      })
  }
}
