/**
 * The Player screen's custom control bar (brief section 2's component
 * tree: "Custom control bar: title, progress, buffered, time, transport
 * buttons, 3.5s auto-hide") -- there is no native OSD anywhere in this
 * client (brief Slice 7 acceptance: "Custom control bar (no native OSD)").
 * This file renders chrome only; it owns no `@kit.MediaKit` state at all --
 * every value it shows is a `@Prop` the hosting `pages/Player.ets` (a
 * later slice) feeds in from its own `player/AvPlayerController.ets`, and
 * every button here only ever calls a plain callback prop, never touches
 * the player directly.
 *
 * ## Always dark, regardless of theme (brief 5.6)
 *
 * "Context drawers and the player are always dark regardless of theme:
 * `linear-gradient(180deg, rgba(34,25,31,0.98), rgba(12,9,12,0.99))`, `#fff`
 * text." Unlike every other component in this design system, this file
 * therefore NEVER reads `design/Theme.ets`'s `activeColors()`/
 * `resolvedThemeMode()` and has NO `@StorageProp('colorMode')`/
 * `('themeModeSetting')` re-render hook -- there is nothing theme-dependent
 * left to re-render for. Every colour below is a fixed literal.
 *
 * ## Where the brand pink is allowed here (brief 5.3 / 5.6)
 *
 * "`--player-accent` (all player chrome: progress fill, ...)" is one of the
 * few places `BRAND_PINK` (`core/Tokens.ts`) is correct -- everywhere else
 * in this app it is explicitly NOT the button colour (brief 5.3: "Using
 * the pink for CTAs is the single most obvious way to look wrong"). Here it
 * is used for exactly two things: the progress-bar fill, and the small
 * "LIVE" badge that replaces the progress bar for an unresolved/live
 * duration (see "Progress math" below) -- both a direct "player-accent"
 * role, nothing more. Every button and every icon in this bar is plain
 * white, not pink.
 *
 * ## Auto-hide (brief 5.10 `playerAutoHideMs`, 3500 ms both profiles)
 *
 * `design/Metrics.ets#activeGeometry()`'s own header comment explicitly
 * names `playerAutoHideMs` as one of the handful of fields shared,
 * identically-named, across `TvGeometryTokens`/`TouchGeometryTokens` --
 * this file is exactly the "generic component" that comment anticipates
 * reading it profile-agnostically through that union accessor, rather than
 * branching on `isTvMetrics()` the way every other (profile-divergent)
 * metric in this file does.
 *
 * The timer (`scheduleAutoHide()`/`autoHideTimerHandle`) only ever runs
 * while `isPlaying` is true AND no button in this bar holds focus
 * (`focusedCount === 0`) -- brief: "auto-hiding after 3500 ms while playing
 * with nothing focused". `ChromeButton` below reports its own focus
 * transitions up via `notifyFocusChanged`, which this component aggregates
 * into that one `focusedCount`.
 *
 * Two distinct triggers make the bar reappear immediately, both ending in
 * the same `reveal()`:
 * - a button in THIS bar gaining focus (`setChildFocused(true)`), and
 * - `keepAliveSignal` changing -- a plain counter the hosting page bumps on
 *   every key-down or touch ANYWHERE on the player screen, including over
 *   the video surface, which is a SIBLING of this component, not something
 *   inside its own subtree (this component's own `onKeyEvent`-free design,
 *   below, means it has no way to observe those key/touch events itself).
 *   `@Prop @Watch('onKeepAliveSignal')` is the ArkUI-idiomatic way to react
 *   to an externally-driven value change without an imperative method call
 *   on a child component instance.
 *
 * The show/hide cross-fade uses `design/Motion.ets#FADE_OPACITY_MS` (brief
 * 5.7: "Property fades: `ease` 180 ms (opacity/colour/background)") with
 * the ambient `Curve.Ease` that same brief line names -- not
 * `INTERACTION_CURVE`, which is reserved for the cubic-bezier interaction
 * curve brief 5.7 gives a different role (cards/buttons/rail headings).
 *
 * ## No `.onKeyEvent()` anywhere in this file
 *
 * `player/PlayerInput.ets`'s header comment states the rule this file
 * follows: a focused, clickable node must rely ONLY on `.onClick()` (plus
 * ArkUI's native Enter/OK-triggers-click synthesis) for D-pad activation,
 * never ALSO its own `.onKeyEvent()` for the same key -- that double-wires
 * the same action. Every control in this bar (`ChromeButton`) is
 * `.focusable(true)` + `.onClick()` and nothing else. D-pad key handling
 * for the Player screen (seek, back, media-transport keys) lives entirely
 * in `player/PlayerInput.ets`, consumed by whatever root-level listener
 * `pages/Player.ets` installs above both this bar and the video surface.
 *
 * ## Icons: real vector shapes, not asset references or exotic glyphs
 *
 * No icon asset pipeline exists yet in this project's
 * `resources/base/media/` (only `app_icon`, `start_icon` and
 * `playarr_logo` are real files there today) -- an `$r()` reference to a
 * play-icon media asset that does not exist would fail
 * `scripts/checks/resources.mjs` at build time, not just look wrong. So:
 * - The PAUSE icon is two plain filled `Column`s (`PlayPauseGlyph` below)
 *   -- the exact same "a coloured box is a component" primitive
 *   `design/components/Skeleton.ets` already relies on.
 * - The PLAY icon is a `Polygon` (`.points()` + `.fill()`), a real,
 *   long-standing ArkUI shape primitive -- but (per this project's whole
 *   offline-validation strategy: no ArkTS compiler, no device) this is the
 *   one piece of this file that cannot be verified without one, flagged
 *   here rather than silently assumed correct, the same "record it as an
 *   explicit divergence" posture `design/components/MediaRail.ets` and
 *   `design/components/NavRail.ets` already establish for their own
 *   unverified assumptions.
 * - Seek back/forward render as literal `'-10s'`/`'+10s'` text rather than
 *   an icon at all -- deliberately, both to avoid a THIRD unverified glyph
 *   shape and because the number is the actual seek amount
 *   `player/PlayerInput.ets#SEEK_STEP_MS` (10000 ms) applies, so the label
 *   is exact, not decorative.
 * - The mandatory top-row "Back" button (brief 5.10: "top buttons 48 tall
 *   labelled" TV / "44 tall icon-only" touch) reads the literal word
 *   `'Back'` on the TV profile and a plain `'<'` character on touch --
 *   satisfying "labelled" vs "icon-only" with zero glyph-availability risk
 *   (every font renders ASCII). This bar deliberately does NOT expose a
 *   generic extensible top-actions row (a later audio-track/subtitle-
 *   track/quality picker) -- out of scope here; adding one is a future
 *   caller-facing addition to this file, not a gap in it.
 *
 * ## Progress math (brief: "`duration === -1` (live) is guarded everywhere
 * progress maths runs")
 *
 * `durationMs <= 0` (an unresolved `duration_ms === 0` that
 * `core/PlaybackMath.ts#resolveDurationMs` has not yet reconciled, or a
 * genuinely live source) is treated as "live": the progress bar and
 * remaining-time text are replaced by a bare elapsed time plus a small
 * "LIVE" badge, rather than computing a `position/duration` fraction that
 * would divide by zero or render a meaningless bar. `positionMs`/
 * `durationMs`/`bufferedPositionMs` are all plain player-local values (NOT
 * `core/PlaybackMath.ts#reportedPositionMs`-adjusted) -- that adjustment is
 * exclusively for what gets reported to the server
 * (`player/PlaybackSessionReporter.ets`), never for what this bar displays.
 *
 * ## Metrics (brief 5.10's "player control bar" row)
 *
 * `paddingH`/`gap`/`titleFontSize`/`playIconSize`/`topButtonHeight` each
 * default from the active device profile via a small `defaultChrome*()`
 * helper (mirroring `design/components/MediaRail.ets`'s own
 * `defaultRailItemGap()`/`defaultRailHeadingSize()` pattern) but remain
 * overridable `@Prop`s. Two profile asymmetries are worth calling out:
 * - TV's field is `playerControlBarPaddingH` (explicitly horizontal-only);
 *   touch's is `playerControlBarPadding` (no `H` suffix) -- read here as a
 *   deliberate naming difference, not an oversight: TV gets horizontal-only
 *   padding (with a separate, reasoned vertical inset, `Spacing.md`);
 *   touch's single field is applied uniformly on all four sides.
 * - Touch has no `playerControlBarTitleSize`/`playerControlBarGap` field at
 *   all. `TOUCH_TITLE_FONT_SIZE_FALLBACK`/`TOUCH_CHROME_GAP_FALLBACK` below
 *   are reasoned defaults (the latter reuses `core/Tokens.ts`'s generic
 *   `Spacing.sm`), the same documented-exception pattern
 *   `design/components/PosterCard.ets`/`AsyncState.ets` already establish
 *   for brief literals with no home in `core/Tokens.ts`.
 */

import { nunito, nunitoAt, webLineHeight } from '../design/Typography';
import { isTvMetrics, tv, activeGeometry } from '../design/Metrics';
import { TvGeometry, TouchGeometry, BRAND_PINK, Spacing } from '../core/Tokens';
import type { RgbaColor } from '../core/Tokens';
import { toResourceColor, toResourceColorWithAlpha } from '../design/Theme';
import { INTERACTION_CURVE, INTERACTION_CARD_MS, FADE_OPACITY_MS } from '../design/Motion';
import { FOCUS_LIFT, effectiveFocusPercent, DEFAULT_ACTIVE_RAIL_FACTOR } from '../design/components/FocusLift';

// -- Fixed dark-mode-only palette (brief 5.6) -- see this file's header. --

const CHROME_GRADIENT_TOP: RgbaColor = { r: 34, g: 25, b: 31, a: 0.98 };
const CHROME_GRADIENT_BOTTOM: RgbaColor = { r: 12, g: 9, b: 12, a: 0.99 };
const CHROME_TEXT_PRIMARY: RgbaColor = { r: 255, g: 255, b: 255, a: 1 };
const CHROME_GLASS: RgbaColor = { r: 12, g: 9, b: 12, a: 1 };
const CHROME_TEXT_SECONDARY: RgbaColor = { r: 255, g: 255, b: 255, a: 0.7 };
/** web: the slash between the elapsed and total time is the muted text token, the two times are white */
const CHROME_TEXT_MUTED: RgbaColor = { r: 165, g: 150, b: 158, a: 1 };
const CHROME_TRACK_ALPHA: number = 0.28;
const CHROME_BUFFERED_ALPHA: number = 0.46;

// Brief 5.4's "button" typographic role (16 / 720 -> `FontWeight.Bold` per
// that section's own weight-rounding guidance) -- reused for every text
// label in this bar (Back, seek back/forward) since none of them has a
// more specific role of its own in brief 5.4's table.
const BUTTON_LABEL_FONT_SIZE: number = 16;

// Brief 5.4's "title meta" role's SIZE (15) -- the closest documented
// "small info text near a title" role, reused for elapsed/remaining time
// and the LIVE badge rather than inventing an unrelated new size.
const TIME_LABEL_FONT_SIZE: number = 15;

// Not in the brief at all -- see this file's header comment ("Metrics").
const TOUCH_TITLE_FONT_SIZE_FALLBACK: number = 15;
const TOUCH_CHROME_GAP_FALLBACK: number = Spacing.sm;
const PROGRESS_TRACK_HEIGHT: number = 4;
const CIRCLE_FILL_ALPHA: number = 0.08;
const CIRCLE_RING_ALPHA: number = 0.4;
// Web TV player (1920x1080): the close button, the progress track and the transport row.
// Phone (web phone player, 360 vp reference).
const PHONE_TOP_BUTTON: number = 44;
const PHONE_SIDE: number = 12;
const PHONE_TOP: number = 14;
const PHONE_TRACK_HEIGHT: number = 6;
const PHONE_PLAY_SIZE: number = 44;
// Web phone control row: seven 45.8 vp slots, the first icon centred 41.7 vp in; the second row holds the quality facts and three icons.
const PHONE_SLOT: number = 45.8;
const PHONE_ROW_HEIGHT: number = 46;
const PHONE_TIME_FONT_SIZE: number = 9.92; // web: 0.62rem
const TV_CLOSE_SIZE: number = 48;
const TV_CLOSE_RIGHT: number = 58;
const TV_CLOSE_TOP: number = 38;
const TV_BAR_SIDE: number = 70;
const TV_BAR_BOTTOM: number = 58;
const TV_TRACK_HEIGHT: number = 6;
const TV_PLAY_SIZE: number = 64;
const TV_SEEK_SIZE: number = 64;
const TV_ROW_GAP: number = 13.6;
const TV_BAR_GAP: number = 0; // web: the 44 px seek row sits directly over the controls
const TV_TIME_FONT_SIZE: number = 10.88; // web: 0.68rem
const TV_QUALITY_WIDTH: number = 120;
const TV_VOLUME_WIDTH: number = 64;
const BACK_BUTTON_WIDTH_TV: number = 96;

function defaultChromePaddingH(): number {
  if (isTvMetrics()) {
    return tv(TvGeometry.playerControlBarPaddingH);
  }
  return TouchGeometry.playerControlBarPadding;
}

function defaultChromePaddingV(): number {
  if (isTvMetrics()) {
    return Spacing.md;
  }
  return TouchGeometry.playerControlBarPadding;
}

function defaultChromeGap(): number {
  if (isTvMetrics()) {
    return tv(TvGeometry.playerControlBarGap);
  }
  return TOUCH_CHROME_GAP_FALLBACK;
}

function defaultChromeTitleFontSize(): number {
  if (isTvMetrics()) {
    return tv(TvGeometry.playerControlBarTitleSize);
  }
  return TOUCH_TITLE_FONT_SIZE_FALLBACK;
}

function defaultChromePlayIconSize(): number {
  if (isTvMetrics()) {
    return tv(TvGeometry.playerControlBarPlayIconSize);
  }
  return TouchGeometry.playerControlBarPlayIconSize;
}

function defaultChromeTopButtonHeight(): number {
  if (isTvMetrics()) {
    return tv(TvGeometry.playerControlBarTopButtonSize);
  }
  return TouchGeometry.playerControlBarTopButtonSize;
}

/** The seek/play-pause transport buttons are square, sized from the play
 * icon plus one generic `Spacing` step of breathing room on each side --
 * not a brief literal, a reasoned tap-target size in the same spirit as
 * `design/components/PosterCard.ets`'s own `PROGRESS_BAR_HEIGHT`. */
function defaultChromeTransportBoxSize(): number {
  return defaultChromePlayIconSize() + Spacing.md;
}

/** Formats a millisecond duration as `m:ss`, or `h:mm:ss` once it reaches
 * an hour. Negative input clamps to zero. Presentation-only formatting
 * local to this component -- it makes no decision `core/PlaybackMath.ts`
 * documents (no clamping to duration, no completion threshold), it only
 * renders an already-decided millisecond value as text. */
function formatClockMs(ms: number): string {
  const totalSeconds = Math.floor(Math.max(0, ms) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const paddedSeconds = String(seconds).padStart(2, '0');
  if (hours > 0) {
    const paddedMinutes = String(minutes).padStart(2, '0');
    return String(hours) + ':' + paddedMinutes + ':' + paddedSeconds;
  }
  return String(minutes) + ':' + paddedSeconds;
}

const PAUSE_BAR_WIDTH_RATIO: number = 0.24;
const PAUSE_BAR_HEIGHT_RATIO: number = 0.78;
const PAUSE_BAR_GAP_RATIO: number = 0.2;
const PLAY_TRIANGLE_INSET_X_RATIO: number = 0.22;
const PLAY_TRIANGLE_TIP_X_RATIO: number = 0.86;
const PLAY_TRIANGLE_TOP_Y_RATIO: number = 0.12;
const PLAY_TRIANGLE_BOTTOM_Y_RATIO: number = 0.88;
const PLAY_TRIANGLE_CENTER_Y_RATIO: number = 0.5;

/** The play/pause transport glyph -- see this file's header comment,
 * "Icons: real vector shapes...", for why this is drawn rather than
 * referencing an asset or a Unicode symbol. Purely presentational: no
 * focus/click handling of its own, that lives on `ChromeButton` below. */
@Component
struct PlayPauseGlyph {
  @Prop isPlaying: boolean = false;
  @Prop glyphSize: number = 24;

  build() {
    Image(this.isPlaying ? $r('app.media.player_pause') : $r('app.media.player_play'))
      .width(this.glyphSize)
      .height(this.glyphSize)
  }
}

/**
 * One focusable, clickable control in this bar. Renders `label` as plain
 * text unless `showGlyph` is set, in which case it renders `PlayPauseGlyph`
 * instead (the play/pause button). Deliberately never attaches
 * `.onKeyEvent()` -- see this file's header comment.
 */
@Component
struct ChromeButton {
  label: string = '';
  /** The control's accessible name (it is a button), empty for none. */
  nodeName: string = '';
  buttonWidth: number = 44;
  buttonHeight: number = 44;
  fontSize: number = BUTTON_LABEL_FONT_SIZE;
  showGlyph: boolean = false;
  isPlaying: boolean = false;
  glyphSize: number = 24;

  /** Plain (non-reactive) callback fields -- functions are not observable
   * state, the same pattern as every other content component in this
   * design system (e.g. `design/components/PosterCard.ets#onSelect`). */
  /** Web TV player: a round button with a hairline ring (the play button's ring is heavier). */
  /** False draws the button dimmed and takes it out of focus (web's disabled previous and next). */
  active: boolean = true;
  circle: boolean = false;
  ringWidth: number = 1;
  /** Phone: web's lighter circle fill and ring, and an icon in place of a text label. */
  fillAlpha: number = CIRCLE_FILL_ALPHA;
  ringAlpha: number = CIRCLE_RING_ALPHA;
  /** TV top buttons: web's glass fill, near-black at this alpha (0 = use the white fill above). */
  glassAlpha: number = 0;
  icon: Resource | undefined = undefined;
  iconSize: number = 20;

  onActivate: () => void = () => {};
  /** Reports this button's own focus transitions up to the hosting
   * `PlayerChrome`, which aggregates every button's focus state into the
   * one `focusedCount` the auto-hide timer keys off (this file's header
   * comment). */
  notifyFocusChanged: (focused: boolean) => void = () => {};

  @State private focusPercent: number = 0;

  private setFocused(focused: boolean): void {
    const notify = this.notifyFocusChanged;
    this.getUIContext().animateTo({ duration: INTERACTION_CARD_MS, curve: INTERACTION_CURVE }, () => {
      this.focusPercent = focused ? 1 : 0;
    });
    notify(focused);
  }

  build() {

    Stack({ alignContent: Alignment.Center }) {
      if (this.showGlyph) {
        PlayPauseGlyph({ isPlaying: this.isPlaying, glyphSize: this.glyphSize })
      } else if (this.icon !== undefined) {
        Image(this.icon).width(this.iconSize).height(this.iconSize)
      } else {
        Text(this.label).fontFamily(nunitoAt(700, this.fontSize))
          .fontSize(this.fontSize).lineHeight(webLineHeight(this.fontSize)).halfLeading(true)
          .fontWeight(FontWeight.Bold)
          .fontColor(toResourceColor(CHROME_TEXT_PRIMARY))
          .maxLines(1)
      }
    }
    .accessibilityText(this.nodeName).accessibilityRole(this.nodeName.length > 0 ? AccessibilityRoleType.BUTTON : AccessibilityRoleType.ROLE_NONE)
    .width(this.buttonWidth)
    .height(this.buttonHeight)
    .borderRadius(this.circle ? Math.min(this.buttonWidth, this.buttonHeight) / 2 : 0)
    .backgroundColor(this.glassAlpha > 0 ? toResourceColorWithAlpha(CHROME_GLASS, this.glassAlpha) : (this.circle ? toResourceColorWithAlpha(CHROME_TEXT_PRIMARY, this.fillAlpha) : Color.Transparent))
    .border(this.circle ? { width: this.ringWidth, color: toResourceColorWithAlpha(CHROME_TEXT_PRIMARY, this.ringAlpha) } : { width: 0 })
    .scale({ x: (1 + (FOCUS_LIFT.button.scale - 1) * effectiveFocusPercent(this.focusPercent, DEFAULT_ACTIVE_RAIL_FACTOR)), y: (1 + (FOCUS_LIFT.button.scale - 1) * effectiveFocusPercent(this.focusPercent, DEFAULT_ACTIVE_RAIL_FACTOR)) })
    .opacity(this.active ? 1 : 0.28)
    .focusable(this.active)
    .onFocus(() => {
      this.setFocused(true);
    })
    .onBlur(() => {
      this.setFocused(false);
    })
    .onClick(() => {
      if (this.active) {
        this.onActivate();
      }
    })
  }
}

@Component
export struct PlayerChrome {
  @Prop title: string = '';
  @Prop positionMs: number = 0;
  @Prop durationMs: number = 0;
  @Prop bufferedPositionMs: number = 0;
  @Prop isPlaying: boolean = false;

  /** Bumped by the hosting page (`pages/Player.ets`, a later slice) on
   * every key-down or touch anywhere on the player screen -- see this
   * file's header comment, "Auto-hide", for why an external `@Watch`-driven
   * nudge, not a listener owned by this component, is how "reappears
   * immediately on any key press or touch" is satisfied for input this
   * component's own subtree never sees (the video surface is a sibling,
   * not a descendant, of this bar). */
  @Prop @Watch('onKeepAliveSignal') keepAliveSignal: number = 0;

  /** Bumped by the page when BACK should close the controls. */
  @Prop @Watch('onHideSignal') hideSignal: number = 0;

  @Prop paddingH: number = defaultChromePaddingH();
  @Prop paddingV: number = defaultChromePaddingV();
  @Prop gap: number = defaultChromeGap();
  @Prop titleFontSize: number = defaultChromeTitleFontSize();
  @Prop playIconSize: number = defaultChromePlayIconSize();
  @Prop topButtonHeight: number = defaultChromeTopButtonHeight();

  /** Plain (non-reactive) callback fields -- see `ChromeButton#onActivate`'s
   * own comment for why these are not `@Prop`/`@State`. */
  onTogglePlayPause: () => void = () => {};
  onSeekBack: () => void = () => {};
  onSeekForward: () => void = () => {};
  onBack: () => void = () => {};
  /** Subtitles and audio: the CC button (TV) shows only when the file has something to choose. */
  @Prop hasTracks: boolean = false;
  onOpenTracks: () => void = () => {};
  /** Quality: the negotiated quality's name on a pill (TV); empty while the server offers no choice. */
  @Prop qualityLabel: string = '';
  onOpenQuality: () => void = () => {};
  /** Info: the title and stream facts drawer (TV). */
  onOpenInfo: () => void = () => {};
  /** Previous and next in the session's queue (TV). */
  @Prop canPrevious: boolean = false;
  @Prop canNext: boolean = false;
  onPrevious: () => void = () => {};
  onNext: () => void = () => {};
  /** Volume: the player's own output is muted; the button toggles it (TV). */
  @Prop muted: boolean = false;
  onToggleMute: () => void = () => {};
  onVisibilityChanged: (visible: boolean) => void = () => {};

  @State private volumePercent: number = 100;
  @State private chromeOpacity: number = 1;
  @State private visible: boolean = true;
  @State private focusedCount: number = 0;
  private autoHideTimerHandle: number | null = null;

  aboutToAppear(): void {
    this.scheduleAutoHide();
  }

  aboutToDisappear(): void {
    this.clearAutoHideTimer();
  }

  /** `@Watch` target for `keepAliveSignal` -- see this file's header
   * comment, "Auto-hide". */
  private onKeepAliveSignal(): void {
    this.reveal();
  }

  private onHideSignal(): void {
    this.clearAutoHideTimer();
    this.hide();
  }

  private reveal(): void {
    this.visible = true;
    this.onVisibilityChanged(true);
    this.getUIContext().animateTo({ duration: FADE_OPACITY_MS, curve: Curve.Ease }, () => {
      this.chromeOpacity = 1;
    });
    this.scheduleAutoHide();
  }

  private hide(): void {
    this.visible = false;
    this.onVisibilityChanged(false);
    this.getUIContext().animateTo({ duration: FADE_OPACITY_MS, curve: Curve.Ease }, () => {
      this.chromeOpacity = 0;
    });
  }

  private autoHideMs(): number {
    return activeGeometry().playerAutoHideMs;
  }

  private clearAutoHideTimer(): void {
    if (this.autoHideTimerHandle !== null) {
      clearTimeout(this.autoHideTimerHandle);
      this.autoHideTimerHandle = null;
    }
  }

  /** (Re)starts the 3500 ms countdown, or leaves none running at all while
   * `isPlaying` is false or a button in this bar holds focus -- brief:
   * "auto-hiding after 3500 ms while playing with nothing focused". */
  private scheduleAutoHide(): void {
    this.clearAutoHideTimer();
    if (!this.isPlaying || this.focusedCount > 0) {
      return;
    }
    this.autoHideTimerHandle = setTimeout((): void => {
      this.autoHideTimerHandle = null;
      this.hide();
    }, this.autoHideMs());
  }

  /** `ChromeButton#notifyFocusChanged`'s target -- aggregates every
   * button's own focus state into one "is anything in this bar focused"
   * count. Gaining focus always reveals immediately; losing it just
   * restarts the countdown (from zero elapsed, a deliberate simplification
   * -- the brief specifies no partial-countdown-preservation behaviour). */
  private setChildFocused(focused: boolean): void {
    if (focused) {
      this.focusedCount += 1;
      this.reveal();
      return;
    }
    this.focusedCount = Math.max(0, this.focusedCount - 1);
    this.scheduleAutoHide();
  }

  /** See this file's header comment, "Progress math". */
  private isLive(): boolean {
    return this.durationMs <= 0;
  }

  private progressPercent(): number {
    if (this.isLive()) {
      return 0;
    }
    const fraction = this.positionMs / this.durationMs;
    return Math.round(Math.max(0, Math.min(1, fraction)) * 100);
  }

  private bufferedPercent(): number {
    if (this.isLive()) {
      return 0;
    }
    const fraction = this.bufferedPositionMs / this.durationMs;
    return Math.round(Math.max(0, Math.min(1, fraction)) * 100);
  }

  private remainingMs(): number {
    return Math.max(0, this.durationMs - this.positionMs);
  }

  /** The progress track: grey, with the buffered part lighter and the played part in the player accent. */
  @Builder
  private progressTrack(height: number): void {
    Stack({ alignContent: Alignment.Start }) {
      Row()
        .width('100%')
        .height(height)
        .borderRadius(height / 2)
        .backgroundColor(toResourceColorWithAlpha(CHROME_TEXT_PRIMARY, CHROME_TRACK_ALPHA))

      Row()
        .width(`${this.bufferedPercent()}%`)
        .height(height)
        .borderRadius(height / 2)
        .backgroundColor(toResourceColorWithAlpha(CHROME_TEXT_PRIMARY, CHROME_BUFFERED_ALPHA))

      Row()
        .width(`${this.progressPercent()}%`)
        .height(height)
        .borderRadius(height / 2)
        .backgroundColor(toResourceColor(BRAND_PINK))
    }
    .width('100%')
  }

  /** One bare TV control icon in web's 64 px round slot. */
  @Builder
  private tvIcon(icon: Resource, onTap: () => void, active: boolean, name: string = ''): void {
    ChromeButton({
      label: '',
      icon: icon,
      iconSize: tv(20),
      nodeName: isTvMetrics() ? name : '',
      circle: true,
      fillAlpha: 0,
      ringAlpha: 0,
      active: active,
      buttonWidth: tv(TV_SEEK_SIZE),
      buttonHeight: tv(TV_SEEK_SIZE),
      onActivate: onTap,
      notifyFocusChanged: ((focused: boolean): void => {
        this.setChildFocused(focused);
      }),
    })
  }

  /** Previous / next as web draws them: a bar and a triangle in the 64 px slot, dimmed while there is nothing to skip to. */
  @Builder
  private tvSkip(previous: boolean, active: boolean, onTap: () => void): void {
    Stack() {
      Image(previous ? $r('app.media.player_previous') : $r('app.media.player_next')).width(tv(20)).height(tv(20))
    }
    .width(tv(TV_SEEK_SIZE))
    .height(tv(TV_SEEK_SIZE))
    .accessibilityText((previous ? 'Previous episode' : 'Next episode')).accessibilityRole(AccessibilityRoleType.BUTTON).accessibilityGroup(true)
    .borderRadius(tv(TV_SEEK_SIZE / 2))
    .opacity(active ? 1 : 0.28)
    .focusable(active)
    .onClick(() => {
      if (active) {
        onTap();
      }
    })
  }

  /** Web TV player: close at the top right; at the bottom a thin progress track over one row of transport controls and the time. */
  @Builder
  private tvBar(): void {
    Stack({ alignContent: Alignment.TopStart }) {
      // web .player-scrim: the bottom 48% fades to black (0.92) under the controls
      Column()
        .width('100%')
        .height('48%')
        .position({ x: 0, y: '52%' })
        .linearGradient({ direction: GradientDirection.Bottom, colors: [['#00000000', 0.0], ['#EB000000', 1.0]] })
        .hitTestBehavior(HitTestMode.None)
    Column() {
      Row({ space: tv(12) }) {
        // web: the Minimise pill (glass, hairline) beside the round close button
        Row({ space: tv(10) }) {
          Image($r('app.media.player_minimize')).width(tv(20)).height(tv(20))
          Text('Minimise').fontFamily(nunitoAt(700, tv(11.2))).fontSize(tv(11.2)).letterSpacing((isTvMetrics() ? 0.146 : 0)).lineHeight(webLineHeight(tv(11.2))).halfLeading(true).fontWeight(FontWeight.Bold).fontColor(toResourceColor(CHROME_TEXT_PRIMARY)).maxLines(1)
        }
        .width(tv(124))
        .height(tv(TV_CLOSE_SIZE))
        .accessibilityText('Minimise player').accessibilityRole(AccessibilityRoleType.BUTTON).accessibilityGroup(true)
        .justifyContent(FlexAlign.Center)
        .alignItems(VerticalAlign.Center)
        .borderRadius(tv(TV_CLOSE_SIZE / 2))
        .backgroundColor(toResourceColorWithAlpha(CHROME_GLASS, 0.78))
        .border({ width: 1, color: toResourceColorWithAlpha(CHROME_TEXT_PRIMARY, 0.2) })
        .shadow({ radius: tv(24), color: toResourceColorWithAlpha(CHROME_GLASS, 0.35), offsetY: tv(8) })
        .focusable(true)
        .onClick(() => {
          this.onBack();
        })
        ChromeButton({
          label: '',
          icon: $r('app.media.player_close'),
          iconSize: tv(20),
          circle: true,
          glassAlpha: 0.55,
          ringAlpha: 0.2,
          buttonWidth: tv(TV_CLOSE_SIZE),
          buttonHeight: tv(TV_CLOSE_SIZE),
          fontSize: tv(22),
          nodeName: 'Close player',
          onActivate: this.onBack,
          notifyFocusChanged: ((focused: boolean): void => {
            this.setChildFocused(focused);
          }),
        })
      }
      .width('100%')
      .justifyContent(FlexAlign.End)
      .padding({ right: tv(TV_CLOSE_RIGHT), top: tv(TV_CLOSE_TOP) })

      Blank()

      Column({ space: tv(TV_BAR_GAP) }) {
        if (!this.isLive()) {
          Column() {
            this.progressTrack(tv(TV_TRACK_HEIGHT))
          }
          .width('100%')
          .height(tv(44))
          .justifyContent(FlexAlign.Center)
          .accessibilityText('Seek').accessibilityRole(AccessibilityRoleType.SLIDER)
        }
        Row({ space: tv(TV_ROW_GAP) }) {
          this.tvSkip(true, this.canPrevious, this.onPrevious)
          ChromeButton({
            showGlyph: true,
            circle: true,
            fillAlpha: 0.14,
            ringAlpha: 0,
            isPlaying: this.isPlaying,
            glyphSize: tv(20), // web: the 20 px icon
            nodeName: (this.isPlaying ? 'Pause' : 'Play'),
            buttonWidth: tv(TV_PLAY_SIZE),
            buttonHeight: tv(TV_PLAY_SIZE),
            onActivate: this.onTogglePlayPause,
            notifyFocusChanged: ((focused: boolean): void => {
              this.setChildFocused(focused);
            }),
          })
          this.tvSkip(false, this.canNext, this.onNext)
          if (this.isLive()) {
            Text('LIVE').fontFamily(nunitoAt(700, tv(TV_TIME_FONT_SIZE))).fontSize(tv(TV_TIME_FONT_SIZE)).lineHeight(webLineHeight(tv(TV_TIME_FONT_SIZE))).halfLeading(true).fontWeight(FontWeight.Bold).fontColor(toResourceColor(BRAND_PINK))
          } else {
            // web: three spans, the times white and the slash muted, 5.6 apart
            Row({ space: tv(5.6) }) {
              Text(formatClockMs(this.positionMs)).fontFamily(nunitoAt(400, tv(TV_TIME_FONT_SIZE)))
                .fontSize(tv(TV_TIME_FONT_SIZE)).lineHeight(webLineHeight(tv(TV_TIME_FONT_SIZE))).halfLeading(true)
                .fontColor(toResourceColor(CHROME_TEXT_PRIMARY))
              Text('/').fontFamily(nunitoAt(400, tv(TV_TIME_FONT_SIZE)))
                .fontSize(tv(TV_TIME_FONT_SIZE)).lineHeight(webLineHeight(tv(TV_TIME_FONT_SIZE))).halfLeading(true)
                .fontColor(toResourceColor(CHROME_TEXT_MUTED))
              Text(formatClockMs(this.durationMs)).fontFamily(nunitoAt(400, tv(TV_TIME_FONT_SIZE)))
                .fontSize(tv(TV_TIME_FONT_SIZE)).lineHeight(webLineHeight(tv(TV_TIME_FONT_SIZE))).halfLeading(true)
                .fontColor(toResourceColor(CHROME_TEXT_PRIMARY))
            }
          }
          // web: the mute button and the volume slider sit together, 10 apart, after the time
          Row({ space: tv(10) }) {
            this.tvIcon($r('app.media.player_volume'), this.onToggleMute, false, 'Mute')
            Slider({ value: this.volumePercent, min: 0, max: 100, style: SliderStyle.OutSet })
              .width(tv(130))
              .height(tv(44))
              .trackColor(toResourceColorWithAlpha(CHROME_TEXT_PRIMARY, 0.3))
              .selectedColor(toResourceColor(CHROME_TEXT_PRIMARY))
              .blockColor(toResourceColor(CHROME_TEXT_PRIMARY))
              .accessibilityText('Volume').accessibilityRole(AccessibilityRoleType.SLIDER)
              .onChange((value: number): void => {
                this.volumePercent = value;
              })
          }
          Blank()
          // web: the audio-track button, empty while the stream has no alternative track
          Stack()
            .width(tv(TV_SEEK_SIZE))
            .height(tv(TV_SEEK_SIZE))
            .borderRadius(tv(TV_SEEK_SIZE / 2))
            .accessibilityText('Audio: Unavailable').accessibilityRole(AccessibilityRoleType.BUTTON).accessibilityGroup(true)
            .focusable(true)
          this.tvIcon($r('app.media.player_subtitles'), (): void => { if (this.hasTracks) { this.onOpenTracks(); } }, true, 'Subtitles: Off')
          this.tvIcon($r('app.media.player_queue'), (): void => {}, true, 'Playlist: 1 item')
          if (this.qualityLabel.length > 0) {
            // web: the HD badge and the negotiated quality's name, between the queue and info buttons
            Row({ space: tv(12) }) {
              Text('HD').fontFamily(nunitoAt(700, tv(7.68))).fontSize(tv(7.68)).lineHeight(webLineHeight(tv(7.68))).halfLeading(true).fontWeight(FontWeight.Bold).fontColor(toResourceColor(CHROME_TEXT_PRIMARY))
              Text(this.qualityLabel).fontFamily(nunitoAt(700, tv(10.56))).fontSize(tv(10.56)).letterSpacing((isTvMetrics() ? -0.103 : 0)).lineHeight(webLineHeight(tv(10.56))).halfLeading(true).fontWeight(FontWeight.Bold).fontColor(toResourceColor(CHROME_TEXT_PRIMARY)).maxLines(1)
            }
            .width(tv(160.45))
            .height(tv(56))
            .borderRadius(tv(28))
            .accessibilityText('Quality: ' + this.qualityLabel).accessibilityRole(AccessibilityRoleType.BUTTON).accessibilityGroup(true)
            .padding({ left: tv(10) })
            .justifyContent(FlexAlign.Center)
            .onClick(() => {
              this.onOpenQuality();
            })
          }
          this.tvIcon($r('app.media.player_info'), this.onOpenInfo, true, 'Info and playback health')
          this.tvIcon($r('app.media.player_cast'), (): void => {}, true, 'Play on another device')
          this.tvIcon($r('app.media.player_fullscreen'), (): void => {}, true, 'Enter fullscreen')
        }
        .width('100%')
        .alignItems(VerticalAlign.Center)
      }
      .width('100%')
      .padding({ left: tv(TV_BAR_SIDE), right: tv(TV_BAR_SIDE), bottom: tv(TV_BAR_BOTTOM) })
    }
    .width('100%')
    .height('100%')
    }
    .width('100%')
    .height('100%')
    .opacity(this.chromeOpacity)
    .hitTestBehavior(this.visible ? HitTestMode.Default : HitTestMode.Transparent)
  }

  /** One phone control: web's 44 vp button at an absolute position, a bare icon (no ring) unless `circle`; `faded` is web's disabled 0.28. */
  @Builder
  private phoneButton(name: string, icon: Resource | undefined, iconSize: number, onTap: () => void, circle: boolean, x: number, y: number, faded: boolean = false): void {
    ChromeButton({
      label: '',
      icon: icon,
      iconSize: iconSize,
      circle: true,
      fillAlpha: circle ? 0.04 : 0,
      ringAlpha: circle ? 0.3 : 0,
      active: !faded,
      nodeName: name,
      buttonWidth: 44,
      buttonHeight: 44,
      onActivate: onTap,
      notifyFocusChanged: ((focused: boolean): void => {
        this.setChildFocused(focused);
      }),
    })
      .position({ x: x, y: y })
  }

  /** Previous / next as web draws them: a bar and a triangle inside a 44 vp button, dimmed while there is nothing to skip to. */
  @Builder
  private phoneSkip(previous: boolean, active: boolean, onTap: () => void, x: number, y: number): void {
    Stack() {
      Image(previous ? $r('app.media.player_previous') : $r('app.media.player_next')).width(20).height(20)
    }
    .width(44)
    .height(44)
    .accessibilityText((previous ? 'Previous episode' : 'Next episode')).accessibilityRole(AccessibilityRoleType.BUTTON).accessibilityGroup(true)
    .borderRadius(22)
    .opacity(active ? 1 : 0.28)
    .focusable(active)
    .position({ x: x, y: y })
    .onClick(() => {
      if (active) {
        onTap();
      }
    })
  }

  /** Web phone player (360 vp reference), every control at web's own box: round minimise and close at the top right; at the bottom the 44 vp
   * seek slider over a 6 vp track, the time centred under it, a row of 44 vp buttons (previous, play, next, mute, volume, subtitles, queue)
   * and a second row of quality, info, devices and full screen. */
  @Builder
  private touchBar(): void {
    Stack({ alignContent: Alignment.TopStart }) {
      this.phoneButton('Minimise player', $r('app.media.player_minimize'), 20, this.onBack, true, 248, 14)
      this.phoneButton('Close player', $r('app.media.player_close'), 22, this.onBack, true, 300, 14)
      if (!this.isLive()) {
        Column() {
          this.progressTrack(PHONE_TRACK_HEIGHT)
        }
        .width(336)
        .height(44)
        .justifyContent(FlexAlign.Center)
        .accessibilityText('Seek').accessibilityRole(AccessibilityRoleType.SLIDER)
        .position({ x: 12, y: 615.13 })
        Row({ space: 5.6 }) {
          Text(formatClockMs(this.positionMs)).fontFamily(nunitoAt(400, PHONE_TIME_FONT_SIZE))
            .fontSize(PHONE_TIME_FONT_SIZE).lineHeight(webLineHeight(PHONE_TIME_FONT_SIZE)).halfLeading(true)
            .fontColor(toResourceColor(CHROME_TEXT_PRIMARY))
          Text('/').fontFamily(nunitoAt(400, PHONE_TIME_FONT_SIZE))
            .fontSize(PHONE_TIME_FONT_SIZE).lineHeight(webLineHeight(PHONE_TIME_FONT_SIZE)).halfLeading(true)
            .fontColor(toResourceColor(CHROME_TEXT_MUTED))
          Text(formatClockMs(this.durationMs)).fontFamily(nunitoAt(400, PHONE_TIME_FONT_SIZE))
            .fontSize(PHONE_TIME_FONT_SIZE).lineHeight(webLineHeight(PHONE_TIME_FONT_SIZE)).halfLeading(true)
            .fontColor(toResourceColor(CHROME_TEXT_PRIMARY))
        }
        .width(336)
        .height(16.88)
        .justifyContent(FlexAlign.Center)
        .position({ x: 12, y: 653.13 })
      }
      this.phoneSkip(true, this.canPrevious, this.onPrevious, 20, 674)
      ChromeButton({
        showGlyph: true,
        circle: true,
        fillAlpha: 0.14,
        ringAlpha: 0,
        ringWidth: 0,
        isPlaying: this.isPlaying,
        glyphSize: 20, // web: the 20 px icon
        nodeName: (this.isPlaying ? 'Pause' : 'Play'),
        buttonWidth: PHONE_PLAY_SIZE,
        buttonHeight: PHONE_PLAY_SIZE,
        onActivate: this.onTogglePlayPause,
        notifyFocusChanged: ((focused: boolean): void => {
          this.setChildFocused(focused);
        }),
      })
        .position({ x: 66, y: 674 })
      this.phoneSkip(false, this.canNext, this.onNext, 112, 674)
      this.phoneButton('Mute', $r('app.media.player_volume'), 20, this.onToggleMute, false, 158, 674)
      this.phoneButton('', $r('app.media.player_volume'), 20, this.onToggleMute, false, 204, 674, true)
      this.phoneButton('Subtitles: Off', $r('app.media.player_subtitles'), 20, this.onOpenTracks, false, 250, 674)
      this.phoneButton('Playlist: 1 item', $r('app.media.player_queue'), 20, (): void => {}, false, 296, 674)
      Row() {
        Text('HD').fontFamily(nunitoAt(700, 7.68)).fontSize(7.68).lineHeight(webLineHeight(7.68)).halfLeading(true).fontWeight(FontWeight.Bold).fontColor(toResourceColor(CHROME_TEXT_PRIMARY))
        Text(this.qualityLabel).fontFamily(nunitoAt(700, 10.56)).fontSize(10.56).lineHeight(webLineHeight(10.56)).halfLeading(true).fontWeight(FontWeight.Bold)
          .fontColor(toResourceColor(CHROME_TEXT_PRIMARY)).width(40.31).maxLines(3).textAlign(TextAlign.Center)
      }
      .width(44)
      .height(44)
      .accessibilityText('Quality: ' + this.qualityLabel).accessibilityRole(AccessibilityRoleType.BUTTON).accessibilityGroup(true)
      .borderRadius(22)
      .justifyContent(FlexAlign.Center)
      .position({ x: 89, y: 722 })
      .onClick(() => {
        this.onOpenQuality();
      })
      this.phoneButton('Info and playback health', $r('app.media.player_info'), 20, this.onOpenInfo, false, 135, 722)
      this.phoneButton('Play on another device', $r('app.media.player_cast'), 20, (): void => {}, false, 181, 722)
      this.phoneButton('Enter fullscreen', $r('app.media.player_fullscreen'), 20, (): void => {}, false, 227, 722)
    }
    .width('100%')
    .height('100%')
    .opacity(this.chromeOpacity)
    .hitTestBehavior(this.visible ? HitTestMode.Default : HitTestMode.Transparent)
  }

  build() {
    if (isTvMetrics()) {
      this.tvBar()
    } else {
      this.touchBar()
    }
  }
}
