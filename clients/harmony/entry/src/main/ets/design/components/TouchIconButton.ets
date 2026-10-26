/** The phone header's round icon button (web phone page actions: the bell, the filter button), 43 px. */

import { activeColors, tintFilter, toResourceColorWithAlpha } from '../Theme';
import type { ThemeModeSetting } from '../Theme';

@Component
export struct TouchIconButton {
  icon: ResourceStr = '';
  label: string = '';
  onTap: () => void = () => {};

  @StorageProp('colorMode') private sysColorMode: ColorMode = ColorMode.LIGHT;
  @StorageProp('themeModeSetting') private themeSetting: ThemeModeSetting = 'system';

  build() {
    // the control is the 44 vp box (named for assistive tech), the icon an 18 vp image inside it, as web draws them
    Stack({ alignContent: Alignment.Center }) {
      Image(this.icon)
        .colorFilter(tintFilter(activeColors().inkSoft))
        .width(18)
        .height(18)
    }
    .width(44)
    .height(44)
    .accessibilityText(this.label).accessibilityRole(AccessibilityRoleType.BUTTON).accessibilityGroup(true)
    .offset({ y: -2 }) // web sits this button 2.3 vp above the Back circle centre (an offset keeps the header height)
    .borderRadius(14)
    .backgroundColor(toResourceColorWithAlpha(activeColors().surfaceStrong, 0.7))
    .border({ width: 1, color: toResourceColorWithAlpha(activeColors().ink, 0.08) })
    // web .action-pill: 0 14 36 rgba(56, 38, 33, 0.08)
    .shadow({ radius: 36, offsetX: 0, offsetY: 14, color: 'rgba(56, 38, 33, 0.08)' })
    .onClick(() => {
      this.onTap();
    })
  }
}
