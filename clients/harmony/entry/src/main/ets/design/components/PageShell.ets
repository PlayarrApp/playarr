/**
 * The TV page shell every shelled page shares (web `PageLayout` with the shell nav): the left nav rail, the logo, the
 * clock and the page header (a round Back and the title, with an optional pink kicker line under it, as Settings'
 * open section). The page supplies its own content, laid out in the same 1920x1080 coordinates, below the chrome.
 * Nav kinds come from `GET /api/v1/catalog/kinds`, loaded here once. One component, so the chrome can never drift
 * between pages.
 */

import { activeColors, toResourceColor, toResourceColorWithAlpha } from '../Theme';
import type { ThemeModeSetting } from '../Theme';
import { tv, TvGeometry } from '../Metrics';
import { NavRail } from './NavRail';
import type { NavRailItem } from './NavRail';
import { PlayarrLogo } from './PlayarrLogo';
import { Clock } from './Clock';
import { BRAND_PINK_SOFT } from '../../core/Tokens';
import { getCatalogKinds } from '../../data/CatalogRepository';
import { buildNavRailItems, buildPrimaryNavItems, buildSecondaryNavItems, navigateFromRail } from '../../navigation/NavItems';
import { getNavStack, popRoute } from '../../navigation/NavStack';

// Web back button and title (the shared header look).
const HEADER_SIZE: number = 50;
const BACK_GLYPH_SIZE: number = 17.28;
const TITLE_SIZE: number = 33.6;
const TITLE_LETTER_SPACING: number = -1.512;
const HEADER_GAP: number = 23;
// Web page header with a subtitle: the kicker 12.288 px pink at y=112.
const KICKER_TOP: number = 112;
const KICKER_SIZE: number = 12.288;
const KICKER_LETTER_SPACING: number = 0.983;

@Component
export struct PageShell {
  @Prop title: string = '';
  /** The pink line under the title (an open section, a count); empty for none. */
  @Prop kicker: string = '';
  /** The nav id of this page, which the rail marks as the current one; empty selects none. */
  @Prop selectedId: string = '';

  @BuilderParam content: () => void = this.emptyContent;

  @Builder
  private emptyContent(): void {}

  @StorageProp('colorMode') private sysColorMode: ColorMode = ColorMode.LIGHT;
  @StorageProp('themeModeSetting') private themeSetting: ThemeModeSetting = 'system';
  @StorageProp('tvScaleFactor') private trackedTvScale: number = 1;

  @State private navItems: NavRailItem[] = [];

  aboutToAppear(): void {
    this.loadNav();
  }

  private async loadNav(): Promise<void> {
    const kinds = await getCatalogKinds();
    this.navItems = buildNavRailItems(kinds.kind === 'ok' ? kinds.value : []);
  }

  @Builder
  private chrome(): void {
    Stack() {
      this.content()
      // NavRail reads `items` once (plain field), so it is created after the kinds arrive.
      if (this.navItems.length > 0) {
        NavRail({
          items: this.navItems,
          primaryItems: buildPrimaryNavItems(),
          secondaryItems: buildSecondaryNavItems(),
          selectedId: this.selectedId,
          onSelect: (id: string): void => {
            navigateFromRail(id, this.selectedId);
          },
        })
      }
      PlayarrLogo({ logoSize: tv(TvGeometry.logoSize) })
        .position({ x: tv(TvGeometry.logoLeft), y: tv(TvGeometry.logoTop) })
      Row() {
        Clock()
      }
      .height(tv(TvGeometry.utilityRowHeight))
      .alignItems(VerticalAlign.Center)
      .position({ x: tv(TvGeometry.clockLeft), y: tv(TvGeometry.utilityRowTop) })
      Row({ space: tv(HEADER_GAP) }) {
        Text('←')
          .fontSize(tv(BACK_GLYPH_SIZE))
          .fontWeight(FontWeight.Bold)
          .fontColor(toResourceColor(activeColors().inkSoft))
          .textAlign(TextAlign.Center)
          .width(tv(HEADER_SIZE))
          .height(tv(HEADER_SIZE))
          .borderRadius(tv(HEADER_SIZE / 2))
          .backgroundColor(toResourceColorWithAlpha(activeColors().surfaceStrong, 0.7))
          .focusable(true)
          .onClick(() => {
            popRoute(getNavStack());
          })
        Text(this.title)
          .fontSize(tv(TITLE_SIZE))
          .fontWeight(FontWeight.Medium)
          .letterSpacing(tv(TITLE_LETTER_SPACING))
          .fontColor(toResourceColor(activeColors().ink))
      }
      .height(tv(HEADER_SIZE))
      .alignItems(VerticalAlign.Center)
      .position({ x: tv(TvGeometry.titlePanelLeft), y: tv(TvGeometry.utilityRowTop) })
      if (this.kicker.length > 0) {
        Text(this.kicker)
          .fontSize(tv(KICKER_SIZE))
          .fontWeight(FontWeight.Bolder)
          .letterSpacing(tv(KICKER_LETTER_SPACING))
          .textCase(TextCase.UpperCase)
          .fontColor(toResourceColor(BRAND_PINK_SOFT))
          .position({ x: tv(TvGeometry.titlePanelLeft + HEADER_SIZE + HEADER_GAP), y: tv(KICKER_TOP) })
      }
    }
    .width('100%')
    .height('100%')
    .backgroundColor(toResourceColor(activeColors().bg))
  }

  build() {
    // `activeColors()` is not tracked by ArkUI, so a theme change rebuilds the shell (keyed by the theme) to repaint it.
    Stack() {
      ForEach([this.themeSetting], (_theme: string) => {
        this.chrome()
      }, (theme: string): string => theme)
    }
    .width('100%')
    .height('100%')
  }
}
