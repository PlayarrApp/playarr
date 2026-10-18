/**
 * The kicker / hero title / meta / synopsis text block shared by the TV
 * home Stage hero (`design/components/Stage.ets`) and the TV Detail page
 * (a later slice places it there too -- see the brief's own directory
 * tree, section 2.5: "FeatureCopy.ets -- Kicker / title / meta / synopsis
 * block used by Stage and Detail").
 *
 * This is a TV-profile component (brief section 5.4's typography table
 * only gives TV-column sizes for the roles below; the touch-profile
 * figures quoted alongside them in the brief belong to a differently
 * composed touch Detail layout that is out of scope here, same as
 * `design/components/PlayarrLogo.ets`'s TV-sized default and
 * `design/components/NavRail.ets`/`NavPill.ets` being separate,
 * profile-exclusive components rather than one universal component
 * branching internally). Every size below is therefore run through
 * `design/Metrics.ets`'s `tv()` scaling helper.
 *
 * ## Typography
 *
 * Sizes, weights, tracking, colours and gaps copy the live web TV stage copy (see the constants below);
 * web is the reference (docs/parity/README.md).
 */

import { LengthMetrics } from '@kit.ArkUI';
import { nunito } from '../Typography';
import { activeColors, toResourceColor, toResourceColorWithAlpha, resolvedThemeMode } from '../Theme';
import type { ThemeModeSetting } from '../Theme';
import { tv } from '../Metrics';
import type { RgbaColor } from '../../core/Tokens';
import { balanceTitle } from '../../core/TitleBalance';

// Web TV stage copy (`.tv-provider`, `.details-panel-title`, `.tv-preview-meta`, `.tv-preview-overview`),
// measured from the live web DOM at 1920x1080.
const KICKER_FONT_SIZE: number = 12.288;
// ArkUI takes weights in steps of 100 (other values fall back to 400); web uses 860 and 560.
const KICKER_FONT_WEIGHT: number = 900;
const KICKER_LETTER_SPACING: number = KICKER_FONT_SIZE * 0.08;
// Dark theme kicker pink on web; light theme keeps the brand pink.
// Web `--brand-ink` in the light theme (#821e36).
const KICKER_COLOR_LIGHT: RgbaColor = { r: 130, g: 30, b: 54, a: 1 };
const KICKER_COLOR_DARK: RgbaColor = { r: 234, g: 166, b: 182, a: 1 };

const HERO_TITLE_FONT_SIZE: number = 69.12;
const HERO_TITLE_FONT_WEIGHT: number = 500; // web 560: nearest static instance below 600 is the closer width
const HERO_TITLE_LETTER_SPACING: number = HERO_TITLE_FONT_SIZE * -0.072;
const HERO_TITLE_LINE_HEIGHT: number = 62;
const HERO_TITLE_MAX_WIDTH: number = 373;
// Web `.tv-detail-copy h2:not(.tv-detail-title)` at 1920x1080.
const EPISODE_TITLE_FONT_SIZE: number = 21.12;
// ArkUI uses 100-step weights; 600 is the nearest native weight to web 570.
const EPISODE_TITLE_FONT_WEIGHT: number = 600;
const EPISODE_TITLE_LETTER_SPACING: number = EPISODE_TITLE_FONT_SIZE * -0.035;
const EPISODE_TITLE_LINE_HEIGHT: number = EPISODE_TITLE_FONT_SIZE * 1.15;
const EPISODE_TITLE_MAX_CHARS: number = 24;
const EPISODE_TITLE_MARGIN_TOP: number = 12.4;
const EPISODE_META_MARGIN_TOP: number = 30;

// Web `.tv-detail-meta`: 0.55vw chips, 0.85rem apart, the first one bolder and softer-ink, the rest muted.
const META_CHIP_FONT_SIZE: number = 10.56;
const META_CHIP_GAP: number = 13.6;
const META_CHIP_ROW_GAP: number = 6.4;

const COPY_TEXT_FONT_SIZE: number = 12.864;
const COPY_TEXT_FONT_WEIGHT: number = 600;
const SYNOPSIS_FONT_WEIGHT: number = 400;
const COPY_TEXT_INK_ALPHA: number = 0.87;
const SYNOPSIS_LINE_HEIGHT: number = 20.4;
const SYNOPSIS_MAX_WIDTH: number = 328;
const SYNOPSIS_MAX_LINES: number = 5;

// Vertical gaps between kicker, title, meta and synopsis on web.
const GAP_KICKER_TITLE: number = 34;
const GAP_TITLE_META: number = 22;
const GAP_META_SYNOPSIS: number = 21;

@Component
export struct FeatureCopy {
  /** Uppercase kicker line (brand pink, `textCase` applied so the source
   * string's own casing is preserved and only the *rendering* is
   * upper-cased, matching CSS `text-transform: uppercase`). Empty string
   * hides the line entirely. */
  @Prop kicker: string = '';
  /** The work/hero title. Wraps naturally within whatever width the
   * caller (`Stage.ets`'s title panel, or later Detail's copy column)
   * gives this component -- the source CSS never line-clamps the title,
   * only `text-wrap: balance`s it, which `balancedTitle()` reproduces. */
  @Prop title: string = '';
  /** Selected episode title shown under the work title on TV Detail. */
  @Prop subtitle: string = '';
  /** Short stacked meta lines (e.g. "2024 - Drama - 2h 15m", then a
   * secondary line). The LAST entry always renders in the smaller, muted
   * treatment, matching `.tv-title-meta span:last-child` -- pass a single
   * entry if there is no secondary line. Empty array hides the whole row. */
  @Prop metaLines: string[] = [];
  /** Detail pages: the meta as web chips (replaces `metaLines` when set). */
  @Prop metaChips: string[] = [];
  /** Synopsis body copy, clamped to `SYNOPSIS_MAX_LINES` lines with an
   * ellipsis. Empty string hides it entirely -- the home Stage hero
   * renders no synopsis in the source design (only Detail supplies one). */
  @Prop synopsis: string = '';
  /** Home only: web's Home hero sits its meta 4 vp higher and its synopsis 3 vp further from it than the Library/Detail panel. Added to
   * the gaps above the meta lines and the synopsis (vp, may be negative). */
  @Prop metaGapAdjust: number = 0;
  @Prop synopsisGapAdjust: number = 0;

  // Tracked purely to force a re-render on theme / TV-scale change; the
  // actual values always go through design/Theme.ets's resolvers and
  // design/Metrics.ets's tv() below (see those files' own header comments
  // for this exact pattern, already used by Skeleton.ets/AsyncState.ets).
  @StorageProp('colorMode') private sysColorMode: ColorMode = ColorMode.LIGHT;
  @StorageProp('themeModeSetting') private themeSetting: ThemeModeSetting = 'system';
  @StorageProp('tvScaleFactor') private trackedTvScale: number = 1;

  private kickerColor(): string {
    return resolvedThemeMode() === 'dark' ? toResourceColor(KICKER_COLOR_DARK) : toResourceColor(KICKER_COLOR_LIGHT);
  }

  private copyTextColor(): string {
    return toResourceColorWithAlpha(activeColors().ink, COPY_TEXT_INK_ALPHA);
  }

  /** Chrome's `text-wrap: balance` for the title (web `.details-panel-title`): ArkUI has none, so the breaks are
   * worked out from measured widths (`core/TitleBalance.ts`) and put into the string. */
  private balancedTitle(): string {
    const ui = this.getUIContext();
    const measureUtils = ui.getMeasureUtils();
    const size = tv(HERO_TITLE_FONT_SIZE);
    return balanceTitle(this.title, (text: string): number => {
      return measureUtils.measureText({
        textContent: text,
        fontSize: size,
        fontWeight: HERO_TITLE_FONT_WEIGHT,
        letterSpacing: tv(HERO_TITLE_LETTER_SPACING),
      });
    }, ui.vp2px(tv(HERO_TITLE_MAX_WIDTH)));
  }

  private episodeSubtitleMaxWidth(): number {
    const ui = this.getUIContext();
    return ui.px2vp(ui.getMeasureUtils().measureText({
      textContent: '0'.repeat(EPISODE_TITLE_MAX_CHARS),
      fontSize: tv(EPISODE_TITLE_FONT_SIZE),
      fontWeight: EPISODE_TITLE_FONT_WEIGHT,
    }));
  }

  build() {
    Column() {
      if (this.kicker.length > 0) {
        Text(this.kicker).fontFamily(nunito(KICKER_FONT_WEIGHT))
          .fontSize(tv(KICKER_FONT_SIZE))
          .fontWeight(KICKER_FONT_WEIGHT)
          .letterSpacing(tv(KICKER_LETTER_SPACING))
          .fontColor(this.kickerColor())
          .textCase(TextCase.UpperCase)
          .margin({ bottom: tv(GAP_KICKER_TITLE) })
      }

      if (this.title.length > 0) {
        Text(this.balancedTitle()).fontFamily(nunito(HERO_TITLE_FONT_WEIGHT))
          .fontSize(tv(HERO_TITLE_FONT_SIZE))
          .fontWeight(HERO_TITLE_FONT_WEIGHT)
          .letterSpacing(tv(HERO_TITLE_LETTER_SPACING))
          .lineHeight(tv(HERO_TITLE_LINE_HEIGHT))
          .constraintSize({ maxWidth: tv(HERO_TITLE_MAX_WIDTH) })
          .fontColor(toResourceColor(activeColors().ink))
      }

      if (this.subtitle.length > 0) {
        Text(this.subtitle).fontFamily(nunito(EPISODE_TITLE_FONT_WEIGHT))
          .fontSize(tv(EPISODE_TITLE_FONT_SIZE))
          .fontWeight(EPISODE_TITLE_FONT_WEIGHT)
          .letterSpacing(tv(EPISODE_TITLE_LETTER_SPACING))
          .lineHeight(tv(EPISODE_TITLE_LINE_HEIGHT))
          .fontColor(toResourceColor(activeColors().inkSoft))
          .constraintSize({ maxWidth: this.episodeSubtitleMaxWidth() })
          .margin({ top: tv(EPISODE_TITLE_MARGIN_TOP) })
      }

      if (this.metaChips.length > 0) {
        Flex({ wrap: FlexWrap.Wrap, space: { main: LengthMetrics.vp(tv(META_CHIP_GAP)), cross: LengthMetrics.vp(tv(META_CHIP_ROW_GAP)) } }) {
          ForEach(
            this.metaChips,
            (chip: string, index: number) => {
              Text(chip).fontFamily(nunito(index === 0 ? 700 : 400))
                .fontSize(tv(META_CHIP_FONT_SIZE))
                .fontWeight(index === 0 ? FontWeight.Bold : FontWeight.Normal)
                .fontColor(toResourceColor(index === 0 ? activeColors().inkSoft : activeColors().inkMuted))
            },
            (chip: string, index: number) => `${index}-${chip}`
          )
        }
        .width('100%')
        .margin({ top: tv(this.subtitle.length > 0 ? EPISODE_META_MARGIN_TOP : GAP_TITLE_META) })
      } else if (this.metaLines.length > 0) {
        Column() {
          ForEach(
            this.metaLines,
            (line: string) => {
              Text(line).fontFamily(nunito(COPY_TEXT_FONT_WEIGHT))
                .fontSize(tv(COPY_TEXT_FONT_SIZE))
                .fontWeight(COPY_TEXT_FONT_WEIGHT)
                .fontColor(this.copyTextColor())
            },
            (line: string, index: number) => `${index}-${line}`
          )
        }
        .alignItems(HorizontalAlign.Start)
        .margin({ top: tv(this.subtitle.length > 0 ? EPISODE_META_MARGIN_TOP : GAP_TITLE_META + this.metaGapAdjust) })
      }

      if (this.synopsis.length > 0) {
        // web `.tv-detail-synopsis`: --ink-muted, no weight set (body 400)
        Text(this.synopsis).fontFamily(nunito(SYNOPSIS_FONT_WEIGHT))
          .fontSize(tv(COPY_TEXT_FONT_SIZE))
          .fontWeight(SYNOPSIS_FONT_WEIGHT)
          .lineHeight(tv(SYNOPSIS_LINE_HEIGHT))
          .fontColor(toResourceColor(activeColors().inkMuted))
          .constraintSize({ maxWidth: tv(SYNOPSIS_MAX_WIDTH) })
          .maxLines(SYNOPSIS_MAX_LINES)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .margin({ top: tv(GAP_META_SYNOPSIS + this.synopsisGapAdjust) })
      }
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
  }
}
