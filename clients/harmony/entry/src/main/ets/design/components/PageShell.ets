/**
 * The TV page shell every shelled page shares (web `PageLayout` with the shell nav): the left nav rail, the logo, the
 * clock and the page header (a round Back and the title, with an optional pink kicker line under it, as Settings'
 * open section). The page supplies its own content, laid out in the same 1920x1080 coordinates, below the chrome.
 * Nav kinds come from `GET /api/v1/catalog/kinds`, loaded here once. One component, so the chrome can never drift
 * between pages.
 */

import { nunito } from '../Typography';
import { activeColors, toResourceColor, toResourceColorWithAlpha } from '../Theme';
import type { ThemeModeSetting } from '../Theme';
import { isTvMetrics, tv, TvGeometry } from '../Metrics';
import { TouchNavBar, TouchNavBarSpacer, touchNavBarBox } from './TouchNavBar';
import { NavRail } from './NavRail';
import type { NavRailItem } from './NavRail';
import { PlayarrLogo } from './PlayarrLogo';
import { Clock } from './Clock';
import { BRAND_PINK_SOFT } from '../../core/Tokens';
import { atLeast } from '../../core/SafeInsets';

import { getCatalogKinds } from '../../data/CatalogRepository';
import { buildNavRailItems, buildPrimaryNavItems, buildSecondaryNavItems, navigateFromRail } from '../../navigation/NavItems';
import { getNavStack, popRoute } from '../../navigation/NavStack';

// Web back button and title (the shared header look).
const HEADER_SIZE: number = 50;
const BACK_GLYPH_SIZE: number = 14.5; // web's arrow glyph is smaller than 1.08rem looks in Nunito
const TITLE_SIZE: number = 33.6;
const TITLE_LETTER_SPACING: number = -1.512;
const HEADER_GAP: number = 23;
// Web `.page-header-detail`: 0.58vw (11.136 px), weight 680, tracking .045em.
const DETAIL_SIZE: number = 11.136;
const DETAIL_LETTER_SPACING: number = 0.501;
const DETAIL_WEIGHT: number = 680; // web .page-header-title-block > span
const CLOCK_STOP: number = 478;
const WRAP_GAP: number = 5.6;
const WRAP_PAD_TOP: number = 6.4;
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
  /** Phone-only drawer/menu layer, painted below the foreground bottom navigation. */
  @BuilderParam touchOverlay: () => void = this.emptyContent;
  /** Phone-only title actions, painted above the bottom navigation bar. */
  @BuilderParam touchForegroundOverlay: () => void = this.emptyContent;
  /** The page's extra header controls (Calendar's range, previous, Today and next), above the content. */
  @BuilderParam controls: () => void = this.emptyContent;

  @Builder
  private emptyContent(): void {}

  @StorageProp('colorMode') private sysColorMode: ColorMode = ColorMode.LIGHT;
  @StorageProp('themeModeSetting') private themeSetting: ThemeModeSetting = 'system';
  @StorageProp('tvScaleFactor') private trackedTvScale: number = 1;
  @StorageProp('safeTop') private safeTop: number = 0;
  @StorageProp('safeBottom') private safeBottom: number = 0;
  @StorageProp('safeLeft') private safeLeft: number = 0;
  @StorageProp('safeRight') private safeRight: number = 0;

  @State private navItems: NavRailItem[] = [];

  aboutToAppear(): void {
    this.loadNav();
  }

  private async loadNav(): Promise<void> {
    const kinds = await getCatalogKinds();
    this.navItems = buildNavRailItems(kinds.kind === 'ok' ? kinds.value : []);
  }

  /** Web `detailFitsInline` (lib/pageHeaderLayout.ts): the detail goes beside the title only while it clears the clock by 16. */
  private measureHeaderText(text: string, size: number, weight: number, spacing: number): number {
    const ui = this.getUIContext();
    return ui.px2vp(ui.getMeasureUtils().measureText({
      textContent: text, fontSize: tv(size), fontWeight: weight, letterSpacing: tv(spacing),
    }));
  }

  private detailTextWidth(): number {
    return Math.ceil(this.measureHeaderText(this.kicker.toUpperCase(), DETAIL_SIZE, DETAIL_WEIGHT, DETAIL_LETTER_SPACING)) + 2;
  }

  private wrappedColumnWidth(): number {
    const title = this.measureHeaderText(this.title, TITLE_SIZE, 500, TITLE_LETTER_SPACING);
    const detail = this.measureHeaderText(this.kicker.toUpperCase(), DETAIL_SIZE, DETAIL_WEIGHT, DETAIL_LETTER_SPACING);
    return Math.ceil(Math.max(title, detail)) + 2;
  }

  private detailFitsInline(): boolean {
    const title = this.measureHeaderText(this.title, TITLE_SIZE, 500, TITLE_LETTER_SPACING);
    const detail = this.measureHeaderText(this.kicker.toUpperCase(), DETAIL_SIZE, DETAIL_WEIGHT, DETAIL_LETTER_SPACING);
    const right = tv(TvGeometry.titlePanelLeft + HEADER_SIZE + HEADER_GAP) + title + tv(HEADER_GAP) + detail + tv(HEADER_GAP + 1);
    return right + tv(16) <= tv(CLOCK_STOP);
  }

  @Builder
  private headerBack(): void {
    Text('←').fontFamily(nunito(400))
      .fontSize(tv(BACK_GLYPH_SIZE))
      .fontWeight(FontWeight.Normal)
      .fontColor(toResourceColor(activeColors().inkSoft))
      .textAlign(TextAlign.Center)
      .width(tv(HEADER_SIZE))
      .height(tv(HEADER_SIZE))
      .borderRadius(tv(HEADER_SIZE / 2))
      .backgroundColor(toResourceColorWithAlpha(activeColors().surfaceStrong, 0.7))
      // Web `.tv-page-back`: a 1px ring in a faint ink tone, and a regular-weight arrow.
      .border({ width: tv(1), color: toResourceColorWithAlpha(activeColors().ink, 0.14) })
      .focusable(true)
      .onClick(() => {
        popRoute(getNavStack());
      })
  }

  @Builder
  private headerTitle(): void {
    Text(this.title).fontFamily(nunito(500))
      .fontSize(tv(TITLE_SIZE))
      .fontWeight(FontWeight.Medium)
      .letterSpacing(tv(TITLE_LETTER_SPACING))
      .fontColor(toResourceColor(activeColors().ink))
      .height(tv(HEADER_SIZE))
  }

  @Builder
  private headerDetail(inline: boolean): void {
    Text(this.kicker).fontFamily(nunito(700))
      .fontSize(tv(DETAIL_SIZE))
      .fontWeight(DETAIL_WEIGHT)
      .letterSpacing(tv(DETAIL_LETTER_SPACING))
      .textCase(TextCase.UpperCase)
      .fontColor(toResourceColor(activeColors().ink))
      .maxLines(1)
      .padding(inline ? { left: tv(HEADER_GAP) } : { top: tv(WRAP_PAD_TOP) })
      .border(inline ? { width: { left: tv(1) }, color: toResourceColor(activeColors().lineStrong) }
        : { width: { top: tv(1) }, color: toResourceColor(activeColors().lineStrong) })
      .width(inline ? this.detailTextWidth() + tv(HEADER_GAP + 2) : '100%')
  }

  /** Web page header: Back, title and, beside it after a divider, the detail; when that cannot fit before the clock the detail wraps
   * under the title with a horizontal rule, in a column as wide as the wider of the two, Back level with the title line. */
  @Builder
  private tvHeader(): void {
    if (this.kicker.length === 0 || this.detailFitsInline()) {
      Row({ space: tv(HEADER_GAP) }) {
        this.headerBack()
        this.headerTitle()
        if (this.kicker.length > 0) {
          this.headerDetail(true)
        }
      }
      .height(tv(HEADER_SIZE))
      .alignItems(VerticalAlign.Center)
      .position({ x: tv(TvGeometry.titlePanelLeft), y: tv(TvGeometry.utilityRowTop) })
    } else {
      Row({ space: tv(HEADER_GAP) }) {
        this.headerBack()
        Column({ space: tv(WRAP_GAP) }) {
          this.headerTitle()
          this.headerDetail(false)
        }
        .width(this.wrappedColumnWidth())
        .alignItems(HorizontalAlign.Start)
      }
      .alignItems(VerticalAlign.Top)
      .position({ x: tv(TvGeometry.titlePanelLeft), y: tv(TvGeometry.utilityRowTop) })
    }
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
        this.tvHeader()
      }
      this.controls()
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
          Text('←').fontFamily(nunito(400))
            .fontSize(10) // web's arrow glyph is 8 vp wide; the fallback font draws 0.92 em
            .fontWeight(FontWeight.Normal)
            .fontColor(toResourceColor(activeColors().inkSoft))
            .textAlign(TextAlign.Center)
            .width(43)
            .height(43)
            .borderRadius(22)
            .backgroundColor(toResourceColorWithAlpha(activeColors().surfaceStrong, 0.7))
            .border({ width: 1, color: toResourceColorWithAlpha(activeColors().ink, 0.2) })
            .onClick(() => {
              popRoute(getNavStack());
            })
          Column() {
            Text(this.title).fontFamily(nunito(500))
              .fontSize(21.6) // web 1.35rem
              .fontWeight(FontWeight.Medium)
              .letterSpacing(-0.972) // web -0.045em
              .fontColor(toResourceColor(activeColors().ink))
              .maxLines(1)
          }
          .alignItems(HorizontalAlign.Start)
          .layoutWeight(1)
          this.touchActions()
        }
      }
      .width('100%')
      .padding({ left: atLeast(16, this.safeLeft), right: atLeast(16, this.safeRight), top: atLeast(17, this.safeTop), bottom: 12 })
      .alignItems(VerticalAlign.Center)
      // Web phone hides the header subtitle (web #1299): no count or section line under the title.
      Column() {
        this.touchContent()
      }
      .layoutWeight(1)
      .width('100%')
      TouchNavBarSpacer()
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
      if (this.touch && !isTvMetrics()) {
        this.touchOverlay()
        TouchNavBar({ selectedId: this.selectedId })
          .position({ x: 0, y: '100%' })
          .markAnchor({ x: 0, y: touchNavBarBox(this.safeBottom) })
        this.touchForegroundOverlay()
      }
    }
    .width('100%')
    .height('100%')
  }
}
