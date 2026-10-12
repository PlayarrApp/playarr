/**
 * The TV page shell every shelled page shares (web `PageLayout` with the shell nav): the left nav rail, the logo, the
 * clock and the page header (a round Back and the title, with an optional pink kicker line under it, as Settings'
 * open section). The page supplies its own content, laid out in the same 1920x1080 coordinates, below the chrome.
 * Nav kinds come from `GET /api/v1/catalog/kinds`, loaded here once. One component, so the chrome can never drift
 * between pages.
 */

import { activeColors, toResourceColor, toResourceColorWithAlpha } from '../Theme';
import type { ThemeModeSetting } from '../Theme';
import { isTvMetrics, tv, TvGeometry } from '../Metrics';
import { TouchNavBar } from './TouchNavBar';
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
  /** False for a page with no header (Home): the rail, logo and clock only. */
  @Prop showHeader: boolean = true;

  /** The page's own content, laid out in 1920x1080 coordinates, below the chrome. */
  @BuilderParam content: () => void = this.emptyContent;
  /** Phone: the page supplies `touchContent` (and `touchActions`, the round buttons at the right of the header) and gets the
   * web phone shell: Back and title on top, the bottom nav bar below. False: the TV chrome is drawn (the page has no phone layout). */
  @Prop touch: boolean = false;
  @BuilderParam touchContent: () => void = this.emptyContent;
  @BuilderParam touchActions: () => void = this.emptyContent;
  /** The page's extra header controls (Calendar's range, previous, Today and next), above the content. */
  @BuilderParam controls: () => void = this.emptyContent;

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
      if (this.showHeader) {
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
      }
      this.controls()
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

  @Builder
  private touchChrome(): void {
    Column() {
      Row({ space: 12 }) {
        if (this.showHeader) {
          Text('←')
            .fontSize(17)
            .fontWeight(FontWeight.Bold)
            .fontColor(toResourceColor(activeColors().inkSoft))
            .textAlign(TextAlign.Center)
            .width(40)
            .height(40)
            .borderRadius(20)
            .backgroundColor(toResourceColorWithAlpha(activeColors().surfaceStrong, 0.7))
            .border({ width: 1, color: toResourceColorWithAlpha(activeColors().ink, 0.08) })
            .onClick(() => {
              popRoute(getNavStack());
            })
          Column() {
            Text(this.title)
              .fontSize(22)
              .fontWeight(FontWeight.Medium)
              .letterSpacing(-0.5)
              .fontColor(toResourceColor(activeColors().ink))
              .maxLines(1)
          }
          .alignItems(HorizontalAlign.Start)
          .layoutWeight(1)
          this.touchActions()
        }
      }
      .width('100%')
      .padding({ left: 16, right: 16, top: 17, bottom: this.kicker.length > 0 ? 2 : 12 })
      .alignItems(VerticalAlign.Center)
      if (this.kicker.length > 0) {
        // Web phone: the pink count or section line sits under the title, level with it.
        Text(this.kicker)
          .fontSize(10)
          .fontWeight(FontWeight.Bolder)
          .letterSpacing(0.8)
          .textCase(TextCase.UpperCase)
          .fontColor(toResourceColor(BRAND_PINK_SOFT))
          .width('100%')
          .padding({ left: 68, top: 8, bottom: 3 })
      }
      Column() {
        this.touchContent()
      }
      .layoutWeight(1)
      .width('100%')
      TouchNavBar({ selectedId: this.selectedId })
    }
    .width('100%')
    .height('100%')
    .backgroundColor(toResourceColor(activeColors().bg))
  }

  build() {
    // `activeColors()` is not tracked by ArkUI, so a theme change rebuilds the shell (keyed by the theme) to repaint it.
    Stack() {
      ForEach([this.themeSetting], (_theme: string) => {
        if (this.touch && !isTvMetrics()) {
          this.touchChrome()
        } else {
          this.chrome()
        }
      }, (theme: string): string => theme)
    }
    .width('100%')
    .height('100%')
  }
}
