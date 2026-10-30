/**
 * The TV page shell every shelled page shares (web `PageLayout` with the shell nav): the left nav rail, the logo, the
 * clock and the page header (a round Back and the title, with an optional pink kicker line under it, as Settings'
 * open section). The page supplies its own content, laid out in the same 1920x1080 coordinates, below the chrome.
 * Nav kinds come from `GET /api/v1/catalog/kinds`, loaded here once. One component, so the chrome can never drift
 * between pages.
 */

import { nunito, arrowFont, nunitoAt, webLineHeight } from '../Typography';
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
import { railFrostColors, railFrostColorsFullWidth } from './KeyArtBackdrop';
import { getNavStack, popRoute } from '../../navigation/NavStack';

// Web back button and title (the shared header look).
const HEADER_SIZE: number = 50;
const BACK_GLYPH_SIZE: number = 14.5; // web's arrow glyph is smaller than 1.08rem looks in Nunito
const TITLE_SIZE: number = 33.6;
const TITLE_LETTER_SPACING: number = -1.512;
const HEADER_GAP: number = 23;
// Web `.page-header-detail`: 0.58vw (11.136 px), weight 680, tracking .045em.
const DETAIL_SIZE: number = 11.136;
const DETAIL_LETTER_SPACING: number = 0.79; // web 0.501; ArkUI lays the run out about 3 narrower
const DETAIL_WEIGHT: number = 680; // web .page-header-title-block > span
const CLOCK_STOP: number = 478;
const WRAP_GAP: number = 5.6;
const WRAP_PAD_TOP: number = 7.84;
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
  /** TV: 0 or more paints web's `surface` page base instead of `bg`, plus the right-hand frost of that width in % (0 for none). */
  @Prop railFrostWidthPct: number = -1;
  /** Web draws this page's frost as a full-width box whose fade starts `railFrostWidthPct` from the right edge (Settings, Search). */
  @Prop railFrostFullBox: boolean = false;
  /** TV: draws web's `.tv-stage-wash` (a full-page box, the left wash gradient on `surface`) under the content, as Settings' page has. */
  @Prop stageWash: boolean = false;

  /** The page's own content, laid out in 1920x1080 coordinates, below the chrome. */
  @BuilderParam content: () => void = this.emptyContent;
  /** Phone: the page supplies `touchContent` (and `touchActions`, the round buttons at the right of the header) and gets the
   * web phone shell: Back and title on top, the bottom nav bar below. False: the TV chrome is drawn (the page has no phone layout). */
  @Prop touch: boolean = false;
  @BuilderParam touchContent: () => void = this.emptyContent;
  /** Phone: the content runs under the translucent nav bar (web's scroll area), so no spacer is reserved; the page pads its own scroll end. */
  contentUnderNav: boolean = false;
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
    // web: the link (ring, fill) holds the arrow glyph as its own text
    Row() {
      Text('←').fontFamily(arrowFont(720))
        .fontSize(17.28).lineHeight(webLineHeight(17.28)).halfLeading(true) // web dump: 17.28, Liberation Sans bold
        .fontWeight(FontWeight.Normal)
        .fontColor(toResourceColor(activeColors().inkSoft))
        .textAlign(TextAlign.Center)
    }
    .justifyContent(FlexAlign.Center)
    .width(tv(HEADER_SIZE))
    .height(tv(HEADER_SIZE))
    .borderRadius(tv(HEADER_SIZE / 2))
    .backgroundColor(toResourceColorWithAlpha(activeColors().surfaceStrong, 0.7))
    // Web `.tv-page-back`: a 1px ring in a faint ink tone, and a regular-weight arrow.
    .border({ width: tv(1), color: toResourceColorWithAlpha(activeColors().ink, 0.14) })
    .accessibilityText(this.backLabel).accessibilityRole(this.backRole === 'button' ? AccessibilityRoleType.BUTTON : AccessibilityRoleType.HYPERLINK).accessibilityGroup(true)
    .focusable(true)
    .onClick(() => {
      popRoute(getNavStack());
    })
  }

  @Builder
  private headerTitle(): void {
    Text(this.title).fontFamily(nunitoAt(580, tv(TITLE_SIZE)))
      
      .fontSize(tv(TITLE_SIZE)).lineHeight(webLineHeight(tv(TITLE_SIZE))).halfLeading(true)
      .fontWeight(FontWeight.Medium)
      .letterSpacing((tv(TITLE_LETTER_SPACING)) + (isTvMetrics() ? -0.23 : 0))
      .fontColor(toResourceColor(activeColors().ink))
      .height(tv(HEADER_SIZE))
      .translate({ y: 0.2 }) // web's title box sits level with the web header's
  }

  @Builder
  private headerDetail(inline: boolean): void {
    Text(this.kicker).fontFamily(nunitoAt(700, tv(DETAIL_SIZE)))
      .fontSize(tv(DETAIL_SIZE)).lineHeight(webLineHeight(tv(DETAIL_SIZE))).halfLeading(true)
      .fontWeight(DETAIL_WEIGHT)
      .letterSpacing(tv(DETAIL_LETTER_SPACING))
      .textCase(TextCase.UpperCase)
      .fontColor(toResourceColor(activeColors().ink))
      .maxLines(1)
      .padding(inline ? { left: tv(HEADER_GAP) } : { top: tv(WRAP_PAD_TOP) })
      .border(inline ? { width: { left: tv(1) }, color: toResourceColor(activeColors().lineStrong) }
        : { width: { top: tv(1) }, color: toResourceColor(activeColors().lineStrong) })
      .width(inline ? this.detailTextWidth() + tv(HEADER_GAP + 2) : '100%')
      .translate(inline ? { x: -2, y: -1.2 } : { x: 0, y: 0 }) // web: the count sits 2 px left and 1.2 px higher
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
    // Web's DOM: the page base (`bg`) holds the fixed rail, logo and clock; the page wrapper on `surface` holds the header and the content.
    Stack() {
      Stack() {
        if (this.railFrostWidthPct > 0) {
          Row()
            .width(this.railFrostFullBox ? '100%' : `${this.railFrostWidthPct}%`)
            .height('100%')
            .position({ x: this.railFrostFullBox ? 0 : `${100 - this.railFrostWidthPct}%`, y: 0 })
            .linearGradient({ angle: 90, colors: this.railFrostFullBox ? railFrostColorsFullWidth(this.railFrostWidthPct) : railFrostColors() })
            .hitTestBehavior(HitTestMode.None)
        }
        if (this.stageWash) {
          Row()
            .width('100%')
            .height('100%')
            .position({ x: 0, y: 0 })
            .hitTestBehavior(HitTestMode.None)
            .linearGradient({
              angle: 90,
              colors: [
                [toResourceColorWithAlpha(activeColors().surface, TvGeometry.stageWashLeftOpacityPct / 100), 0],
                [toResourceColorWithAlpha(activeColors().surface, TvGeometry.stageWashLeftMidOpacityPct / 100), TvGeometry.stageWashLeftMidPct / 100],
                [toResourceColorWithAlpha(activeColors().surface, 0), TvGeometry.stageWashLeftFadePct / 100],
              ],
            })
        }
        this.content()
        if (this.showHeader) {
          this.tvHeader()
        }
        this.controls()
      }
      .width('100%')
      .height('100%')
      .backgroundColor(toResourceColor(activeColors().surface))
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
    }
    .width('100%')
    .height('100%')
    .backgroundColor(toResourceColor(activeColors().bg))
  }

  /** The phone Back control's accessible name (web `aria-label` on the round Back link; it differs per page). */
  @Prop backLabel: string = 'Back to Home';
  @Prop backRole: string = 'link';

  @Builder
  private touchChrome(): void {
    Column() {
      Row({ space: 10 }) {
        if (this.showHeader) {
          // web: the link (ring, fill) holds the arrow glyph as its own text
          Row() {
            Text('←').fontFamily(arrowFont(720))
              .fontSize(12.8).lineHeight(webLineHeight(12.8)).halfLeading(true) // web dump: 12.8 / 720
              .fontWeight(FontWeight.Normal)
              .fontColor(toResourceColor(activeColors().inkSoft))
              .textAlign(TextAlign.Center)
          }
          .justifyContent(FlexAlign.Center)
          .width(44)
          .height(44)
          .padding({ bottom: 2.9 }) // web's glyph box sits 1.45 higher than the centred one
          .borderRadius(22)
          .backgroundColor(toResourceColorWithAlpha(activeColors().surfaceStrong, 0.7))
          .border({ width: 1, color: toResourceColorWithAlpha(activeColors().ink, 0.2) })
      .accessibilityText(this.backLabel).accessibilityRole(this.backRole === 'button' ? AccessibilityRoleType.BUTTON : AccessibilityRoleType.HYPERLINK).accessibilityGroup(true)
          .onClick(() => {
            popRoute(getNavStack());
          })
          Column() {
            Text(this.title).fontFamily(nunitoAt(580, 21.6))
              
              .fontSize(21.6).lineHeight(webLineHeight(21.6)).halfLeading(true) // web 1.35rem
              .fontWeight(FontWeight.Medium)
              .letterSpacing((-0.972) + (!isTvMetrics() ? -0.144 : 0)) // web -0.045em
              .fontColor(toResourceColor(activeColors().ink))
              .maxLines(1)
              .translate({ y: 0 })
          }
          .alignItems(HorizontalAlign.Start)
          .layoutWeight(1)
          this.touchActions()
        }
      }
      .width('100%')
      // Back is 44 vp but web's header row is 43: take the extra vp off the bottom padding
      .padding({ left: atLeast(16, this.safeLeft), right: atLeast(16, this.safeRight), top: atLeast(16, this.safeTop), bottom: 12 })
      .alignItems(VerticalAlign.Center)
      // Web phone hides the header subtitle (web #1299): no count or section line under the title.
      Column() {
        this.touchContent()
      }
      .layoutWeight(1)
      .width('100%')
      if (!this.contentUnderNav) {
        TouchNavBarSpacer()
      }
    }
    .width('100%')
    .height('100%')
    .backgroundColor(toResourceColor(activeColors().surface))
  }

  build() {
    // `activeColors()` is not tracked by ArkUI, so a theme change rebuilds the shell (keyed by the theme) to repaint it.
    Stack() {
    // web's DOM: the page base (`bg`) holds the page wrapper on `surface`, which holds the content and the phone's overlays
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
    .backgroundColor(this.touch && !isTvMetrics() ? toResourceColor(activeColors().surface) : Color.Transparent)
    }
    .width('100%')
    .height('100%')
    .backgroundColor(this.touch && !isTvMetrics() ? toResourceColor(activeColors().bg) : Color.Transparent) // the page base; the phone's bottom bar blends over the page
  }
}
