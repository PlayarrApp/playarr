/**
 * "Who's watching" profile picker (brief section 4.7 "Profiles", section
 * 5.11 "Avatar presets", and section 9 Slice 5's Profiles acceptance
 * criteria).
 *
 * Loads `data/ProfileRepository.ets#listProfiles()` (server route: GET
 * users/profiles, see that file's own header comment for the exact path)
 * and renders its `AvailableProfileResponse[]` as a grid of
 * `design/components/ProfileAvatar.ets` tiles, one per profile, using
 * `core/AvatarPreset.ts`'s `resolveAvatarPreset(userId)` to pick each
 * tile's deterministic gradient preset id (brief 5.11: this page resolves
 * the preset, `ProfileAvatar.ets` never hashes a user id itself). Under
 * `AuthMode::FullAccount` the repository degrades to a single-entry list
 * (brief 4.7); this page renders that as one tile rather than treating a
 * short list as an error or an empty state, per this slice's own
 * acceptance criteria.
 *
 * A tapped/selected profile whose `pin_locked` is true opens a numeric PIN
 * prompt that calls `data/ProfileRepository.ets#verifyPin(...)`; a profile
 * with `pin_locked === false` skips straight to selection. Per brief 4.7,
 * `verify-pin` only unlocks the target profile, it is not itself a profile
 * switch (a real switch needs "a separately stored per-profile session, or
 * a fresh pairing for that profile", left undocumented beyond that one
 * sentence) -- this page's job ends at replacing the nav stack with
 * `ROUTES.Home` once the PIN (if any) is verified, exactly per this
 * slice's acceptance criteria; it does not invent a profile-switch
 * endpoint the brief never specifies.
 *
 * Sign-out calls `getSessionManager().signOut()` (via `AppContainer.ets`,
 * the one approved way a page reaches session state, per this project's
 * layering rule that `pages/` may never import `auth/` or `net/` directly)
 * then replaces the nav stack with `ROUTES.Pairing` (a server address is
 * still configured; `SessionManager.ets#signOut`'s own contract preserves
 * the server address list) or, defensively, `ROUTES.ServerSetup` if
 * `ServerDirectory` reports no active server at all.
 *
 * The TV "Sign in / Add another profile" tile opens the QR sign-in (`ROUTES.Pairing`), as web's TV does; a successful
 * link replaces the route with the picker. Profiles themselves are managed on Playarr Server.
 *
 * Wired into `profile/router_map.json` as the `Profiles` route (name ->
 * `pages/Profiles.ets` -> `ProfilesBuilder`, below), matching
 * `navigation/Routes.ets`'s now-exported `ROUTE_PROFILES` -- the same
 * pattern `pages/ServerSetup.ets` and `pages/Pairing.ets` already
 * established for their own routes in this same slice.
 */

import { nunito } from '../design/Typography';
import type { AvailableProfileResponse } from '../core/Types/Profiles.ts';
import { resolveAvatarPreset } from '../core/AvatarPreset.ts';
import { BRAND_PINK, BRAND_PINK_SOFT, Spacing, Radii } from '../core/Tokens';
import type { RgbaColor } from '../core/Tokens';

import { listProfiles, verifyPin, syncCurrentAvatar } from '../data/ProfileRepository';

import { getSessionManager, getServerDirectory, saveThemeChoice } from '../AppContainer';
import { getNavStack, pushRoute, replaceRoute } from '../navigation/NavStack';
import { ROUTES } from '../navigation/Routes';

import { SelectField, THEME_CHOICES } from '../design/components/SelectField';
import type { Choice } from '../design/components/ChoiceSegments';
import { openInBrowser } from '../util/ExternalLink';
import { activeColors, setThemeModeSetting, tintFilter, toResourceColor, toResourceColorWithAlpha } from '../design/Theme';
import type { ThemeModeSetting } from '../design/Theme';
import { isTvMetrics, tv, TvGeometry } from '../design/Metrics';
import { INTERACTION_CURVE, INTERACTION_CARD_MS } from '../design/Motion';
import { FOCUS_LIFT, effectiveFocusPercent, DEFAULT_ACTIVE_RAIL_FACTOR } from '../design/components/FocusLift';
import { AsyncState, AsyncStateKind } from '../design/components/AsyncState';
import { ProfileAvatar } from '../design/components/ProfileAvatar';
import { PlayarrLogo } from '../design/components/PlayarrLogo';

// Layout/typography literals with no matching `core/Tokens.ts` field (that
// file has no typography table at all, per `design/components/
// FeatureCopy.ets`'s own header comment) -- named constants here rather
// than inline magic numbers, the same documented-exception pattern every
// other `design/`/`pages/` file in this client already follows.
const HEADING_FONT_SIZE: number = 28;
const PIN_TITLE_FONT_SIZE: number = 20;
const SUBHEADING_FONT_SIZE: number = 15;
const PROFILE_NAME_FONT_SIZE: number = 16;
// Web `.profile-action-button` gear: 44 px round, 18 px pink icon.
const SETTINGS_BUTTON_SIZE: number = 44;
const SETTINGS_ICON_SIZE: number = 18;
const PROFILE_STATUS_FONT_SIZE: number = 12;
const ADD_PROFILE_GLYPH_FONT_SIZE: number = 32;

// Avatar sizing: a "who's watching" picker tile is deliberately larger than
// `ProfileAvatar.ets`'s own 64vp default (sized for a nav-rail account
// tile, per that file's own header comment) -- scaled through
// `design/Metrics.ets#tv()` on the TV profile the same way every other
// TV-geometry literal in this client is, and used as-is on the touch
// profile.
const TV_AVATAR_DIAMETER: number = 168;
// Web TV picker geometry (live DOM, 1920x1080).
const TV_CHOICES_TOP: number = 382;
const TV_CHOICE_WIDTH: number = 244;
const TV_CHOICE_GAP: number = 42;
const TV_ACTION_HEIGHT: number = 44;
const TV_ACTION_ICON: number = 18;
const TV_ACTION_TEXT: number = 10.752;
// Web foot-of-page pills at y=1002: Check for updates from x=48, Clients ending at x=1866.
const FOOTER_TOP: number = 1002;
const FOOTER_LEFT: number = 48;
const FOOTER_RIGHT_LEFT: number = 1752;
const CLIENTS_URL: string = 'https://playarr.app/clients';
// Web `.theme-select` on the profile picker: 144 wide at (1551, 50).
const THEME_SELECT_LEFT: number = 1551;
const THEME_SELECT_TOP: number = 50;
const THEME_SELECT_WIDTH: number = 144;
const TV_ADD_START: string = '#3d202a';
const TV_ADD_END: string = '#a82655';
const TOUCH_AVATAR_DIAMETER: number = 104;
// Web phone profile picker (360 vp reference): 144 vp avatars 23 apart from x=25, the heading block from x=32.5, the selects at the top right.
const PHONE_CHOICE_WIDTH: number = 144;
const PHONE_CHOICE_GAP: number = 23;
const PHONE_CHOICES_LEFT: number = 25;
const PHONE_HEADING_LEFT: number = 32.5;
const PHONE_HEADING_SIZE: number = 38.4;
const PHONE_KICKER_TOP: number = 68;
const PHONE_CHOICES_TOP: number = 54;
const PHONE_SELECT_HEIGHT: number = 48;
const PHONE_SELECT_RADIUS: number = 2;
const PHONE_SELECT_WIDTH: number = 112.5;
const PHONE_SELECT_TOP: number = 14;
const PHONE_SELECT_RIGHT: number = 14;
const PHONE_FOOTER_RIGHT: number = 22;
const PHONE_FOOTER_BOTTOM: number = 23;
const AUTO_LANGUAGE_CHOICES: Choice[] = [{ value: 'auto', label: 'Auto' }];
const PIN_DIALOG_AVATAR_DIAMETER: number = 72;

const TILE_MARGIN: number = Spacing.md;
const PIN_LENGTH: number = 4;
const PIN_DIALOG_WIDTH: number = 320;
const PIN_INPUT_WIDTH: number = 180;

// Modal scrim: a plain translucent black, not a theme-dependent
// `core/Tokens.ts` colour role (there is no "modal backdrop" role, and
// `activeColors().ink` would render near-white in dark mode, exactly
// wrong for a dimming backdrop) -- the same documented exception
// `design/components/ProfileAvatar.ets`'s own rgba(255,255,255,*)
// highlight and `design/components/Skeleton.ets`'s shimmer already
// establish for a colour with no matching token.
const MODAL_SCRIM_ALPHA: number = 0.55;

enum ProfilesViewState {
  Loading,
  Error,
  Ready,
}

@Component
struct Profiles {
  // Tracked purely to force a re-render when the theme changes; the actual
  // colour decision always goes through design/Theme.ets's own resolver
  // functions (see that file's header comment for this pattern, already
  // used by every design/ component in this client).
  @StorageProp('colorMode') private sysColorMode: ColorMode = ColorMode.LIGHT;
  @StorageProp('themeModeSetting') private themeSetting: ThemeModeSetting = 'system';

  /** Web's update note under the Check for updates pill; '' before it is tapped. */
  @State private updateNote: string = '';
  @State private viewState: ProfilesViewState = ProfilesViewState.Loading;
  @State private profiles: AvailableProfileResponse[] = [];
  @State private errorMessage: string = '';

  @State private pinTargetProfile: AvailableProfileResponse | null = null;
  @State private pinValue: string = '';
  @State private pinError: string = '';
  @State private pinSubmitting: boolean = false;

  @State private signOutFocusPercent: number = 0;
  @State private pinCancelFocusPercent: number = 0;
  @State private pinContinueFocusPercent: number = 0;

  /** The avatar chosen in Settings > Profile avatar ('' until one is saved on the server). */
  @StorageProp('currentAvatarPreset') private avatarOverride: string = '';

  aboutToAppear(): void {
    syncCurrentAvatar();
    this.loadProfiles();
  }

  /** `GET users/profiles` via `data/ProfileRepository.ets#listProfiles()`.
   * Never throws (`ApiResult` end to end) -- a failure is reflected as
   * `ProfilesViewState.Error` with a message, not an exception. */
  private async loadProfiles(): Promise<void> {
    this.viewState = ProfilesViewState.Loading;
    const result = await listProfiles();
    if (result.kind === 'ok') {
      this.profiles = result.value;
      // The nav rail's identity tile reads the signed-in profile from here.
      for (const profile of result.value) {
        if (profile.is_current) {
          AppStorage.setOrCreate<string>('currentProfileId', profile.id);
          AppStorage.setOrCreate<string>('currentProfileName', profile.display_name);
        }
      }
      this.viewState = ProfilesViewState.Ready;
      return;
    }
    if (result.kind === 'network_failure') {
      this.errorMessage = 'Could not reach the server. Check your connection and try again.';
    } else if (result.envelope.kind === 'general') {
      this.errorMessage = result.envelope.message;
    } else {
      this.errorMessage = 'Something went wrong loading profiles. Please try again.';
    }
    this.viewState = ProfilesViewState.Error;
  }

  /** Tapped/selected from the grid. Only a `pin_locked` profile detours
   * through the PIN prompt (brief 4.7); every other profile goes straight
   * to `completeProfileSelection`. */
  private selectProfile(profile: AvailableProfileResponse): void {
    if (profile.pin_locked) {
      this.pinTargetProfile = profile;
      this.pinValue = '';
      this.pinError = '';
      return;
    }
    this.completeProfileSelection();
  }

  /** Closes any open PIN prompt and replaces the nav stack with Home --
   * never pushes, per this slice's acceptance criteria ("Back from
   * Profiles does not return to Pairing"). See this file's header comment
   * for why this page's own responsibility ends here. */
  private completeProfileSelection(): void {
    this.pinTargetProfile = null;
    this.pinValue = '';
    this.pinError = '';
    replaceRoute(getNavStack(), ROUTES.Home);
  }

  private closePinPrompt(): void {
    this.pinTargetProfile = null;
    this.pinValue = '';
    this.pinError = '';
    this.pinSubmitting = false;
  }

  /** `POST users/profiles/{id}/verify-pin` via `data/ProfileRepository.ets#
   * verifyPin(...)`. A wrong PIN, a disabled/missing target profile, and
   * (under `AuthMode::FullAccount`) a cross-account probe all come back as
   * the same 401 (brief 4.7) -- shown with the same message as a
   * `verified: false` response, by design; this prompt never tries to
   * distinguish them. */
  private async submitPin(): Promise<void> {
    const target = this.pinTargetProfile;
    if (target === null) {
      return;
    }
    if (this.pinValue.length !== PIN_LENGTH || this.pinSubmitting) {
      return;
    }
    this.pinSubmitting = true;
    this.pinError = '';
    const result = await verifyPin(target.id, this.pinValue);
    this.pinSubmitting = false;
    if (result.kind === 'ok') {
      if (result.value.verified) {
        this.completeProfileSelection();
        return;
      }
      this.pinError = 'Incorrect PIN. Try again.';
      return;
    }
    if (result.kind === 'network_failure') {
      this.pinError = 'Could not reach the server. Check your connection and try again.';
      return;
    }
    this.pinError = 'Incorrect PIN. Try again.';
  }

  /** Strips non-digit characters and clamps to `PIN_LENGTH`, so the field
   * only ever holds a plain numeric string regardless of what the on
   * screen keyboard reports. */
  private onPinDigitsChange(rawValue: string): void {
    let digitsOnly = '';
    for (const character of rawValue) {
      if (character >= '0' && character <= '9') {
        digitsOnly = digitsOnly + character;
      }
    }
    if (digitsOnly.length > PIN_LENGTH) {
      digitsOnly = digitsOnly.slice(0, PIN_LENGTH);
    }
    this.pinValue = digitsOnly;
    this.pinError = '';
  }

  /** Sign-out (brief section 9 Slice 3's sign-out contract, consumed here
   * through `AppContainer.ets` only): clears tokens via
   * `getSessionManager().signOut()`, then routes to `ROUTES.Pairing` when a
   * server address is still configured (the normal case -- sign-out
   * preserves the server address list) or, defensively, `ROUTES.ServerSetup`
   * when `ServerDirectory` reports none at all. */
  private async handleSignOut(): Promise<void> {
    await getSessionManager().signOut();
    const activeBaseUrl = getServerDirectory().getActiveBaseUrl();
    if (activeBaseUrl === null) {
      replaceRoute(getNavStack(), ROUTES.ServerSetup);
      return;
    }
    replaceRoute(getNavStack(), ROUTES.Pairing);
  }

  private setSignOutFocused(focused: boolean): void {
    this.getUIContext().animateTo({ duration: INTERACTION_CARD_MS, curve: INTERACTION_CURVE }, () => {
      this.signOutFocusPercent = focused ? 1 : 0;
    });
  }

  private setPinCancelFocused(focused: boolean): void {
    this.getUIContext().animateTo({ duration: INTERACTION_CARD_MS, curve: INTERACTION_CURVE }, () => {
      this.pinCancelFocusPercent = focused ? 1 : 0;
    });
  }

  private setPinContinueFocused(focused: boolean): void {
    this.getUIContext().animateTo({ duration: INTERACTION_CARD_MS, curve: INTERACTION_CURVE }, () => {
      this.pinContinueFocusPercent = focused ? 1 : 0;
    });
  }

  private statusLabel(profile: AvailableProfileResponse): string {
    if (profile.is_current) {
      return 'Watching now';
    }
    return profile.pin_locked ? 'PIN required' : 'Ready';
  }

  /** Web's foot-of-page pills (Check for updates, Clients): a 44 px pill on surface-strong at 0.64, text only. */
  @Builder
  private footerPill(label: string, x: number, y: number, onTap: () => void, phone: boolean = false): void {
    Text(label).fontFamily(nunito(700))
      .fontSize(tv(TV_ACTION_TEXT))
      .fontWeight(FontWeight.Bold)
      .fontColor(toResourceColor(activeColors().inkSoft))
      .height(tv(TV_ACTION_HEIGHT))
      .padding({ left: tv(17), right: tv(17) })
      .borderRadius(tv(TV_ACTION_HEIGHT / 2))
      .backgroundColor(toResourceColorWithAlpha(activeColors().surfaceStrong, 0.64))
      .border({ width: 1, color: toResourceColorWithAlpha(activeColors().ink, 0.16) })
      .position(phone ? { x: '100%', y: '100%' } : { x: tv(x), y: tv(y) })
      .markAnchor(phone ? { x: PHONE_FOOTER_RIGHT + 75, y: PHONE_FOOTER_BOTTOM + TV_ACTION_HEIGHT } : { x: 0, y: 0 })
      .focusable(true)
      .onClick(onTap)
  }

  /** Web `.profile-action-button`: a 44 px pill on surface-strong at 0.64. */
  @Builder
  private tvActionButton(icon: Resource, label: string, tint: RgbaColor, onTap: () => void): void {
    Row({ space: tv(8) }) {
      Image(icon)
        .width(tv(TV_ACTION_ICON))
        .height(tv(TV_ACTION_ICON))
        .colorFilter(tintFilter(tint))
      if (label.length > 0) {
        Text(label).fontFamily(nunito(700))
          .fontSize(tv(TV_ACTION_TEXT))
          .fontWeight(FontWeight.Bold)
          .fontColor(toResourceColor(activeColors().inkSoft))
      }
    }
    .height(tv(TV_ACTION_HEIGHT))
    .constraintSize({ minWidth: tv(TV_ACTION_HEIGHT) })
    .justifyContent(FlexAlign.Center)
    .padding({ left: label.length > 0 ? tv(17) : 0, right: label.length > 0 ? tv(17) : 0 })
    .borderRadius(tv(TV_ACTION_HEIGHT / 2))
    .backgroundColor(toResourceColorWithAlpha(activeColors().surfaceStrong, 0.64))
    .border({ width: 1, color: toResourceColorWithAlpha(activeColors().ink, 0.16) })
    .focusable(true)
    .onClick(onTap)
  }

  /** Web TV profile picker (`pages/Profiles.tsx` at 1920x1080): the pink "Profiles" kicker, an 80.64 px
   * "Who's watching?", 244 px avatars 42 px apart from y=382 with name and status, the current profile's
   * settings and sign-out actions, and the add tile with a dashed ring. */
  @Builder
  private tvPicker(): void {
    Stack({ alignContent: Alignment.Top }) {
      PlayarrLogo({ logoSize: this.pick(TvGeometry.logoSize, 25) })
        .position({ x: this.pick(TvGeometry.logoLeft, 25), y: this.pick(TvGeometry.logoTop, 26) })
      // Web's foot-of-page pills: Check for updates (bottom left) and the Clients link (bottom right). HarmonyOS has
      // no in-app installer, so the update check says what web says for a build that cannot update itself.
      if (isTvMetrics()) {
        this.footerPill(this.updateNote.length > 0 ? 'Try update again' : 'Check for updates', FOOTER_LEFT, FOOTER_TOP, (): void => {
          this.updateNote = 'This Playarr build cannot start native updates.';
        })
      }
      if (this.updateNote.length > 0 && isTvMetrics()) {
        Text(this.updateNote).fontFamily(nunito(400))
          .fontSize(tv(13.4))
          .fontColor(toResourceColor(activeColors().inkSoft))
          .position({ x: tv(FOOTER_LEFT), y: tv(FOOTER_TOP - 28) })
      }
      this.footerPill('Clients ↗', FOOTER_RIGHT_LEFT, FOOTER_TOP, (): void => {
        openInBrowser(getContext(this), CLIENTS_URL);
      }, !isTvMetrics())
      // Web's top-right theme control (the language select needs the Language setting, which is not built here).
      Row({ space: this.pick(0, 8) }) {
        SelectField({
          options: THEME_CHOICES,
          value: this.themeSetting,
          selectWidth: isTvMetrics() ? THEME_SELECT_WIDTH : PHONE_SELECT_WIDTH,
          minHeight: isTvMetrics() ? 56 : PHONE_SELECT_HEIGHT,
          radius: isTvMetrics() ? 12 : PHONE_SELECT_RADIUS,
          onChange: (value: string): void => {
            setThemeModeSetting(value as ThemeModeSetting);
            saveThemeChoice(value as ThemeModeSetting);
          },
        })
        if (!isTvMetrics()) {
          // shortcut: web's language select; the Language setting is not built, so Auto is the only choice and the control only mirrors web's layout.
          SelectField({
            options: AUTO_LANGUAGE_CHOICES,
            value: 'auto',
            selectWidth: PHONE_SELECT_WIDTH,
            minHeight: PHONE_SELECT_HEIGHT,
            radius: PHONE_SELECT_RADIUS,
            onChange: (_value: string): void => {},
          })
        }
      }
        .position(isTvMetrics() ? { x: tv(THEME_SELECT_LEFT), y: tv(THEME_SELECT_TOP) } : { x: '100%', y: PHONE_SELECT_TOP })
        .markAnchor(isTvMetrics() ? { x: 0, y: 0 } : { x: PHONE_SELECT_RIGHT + PHONE_SELECT_WIDTH * 2 + 8, y: 0 })
        .zIndex(2)
      Column() {
      Text('Profiles').fontFamily(nunito(900))
        .fontSize(tv(10.368))
        .fontWeight(FontWeight.Bolder)
        .letterSpacing(tv(1.348))
        .textCase(TextCase.UpperCase)
        .fontColor(toResourceColor(BRAND_PINK_SOFT))
        .height(tv(16))
        .margin({ top: this.pick(162, PHONE_KICKER_TOP), left: isTvMetrics() ? 0 : 145 })
        .alignSelf(isTvMetrics() ? ItemAlign.Auto : ItemAlign.Start)
      Text('Who’s watching?').fontFamily(nunito(500))
        .fontSize(this.pick(80.64, PHONE_HEADING_SIZE))
        .fontWeight(FontWeight.Medium)
        .letterSpacing(this.pick(-5.806, -2.77))
        .fontColor(toResourceColor(activeColors().ink))
        .height(this.pick(77, 37))
        .margin({ top: this.pick(-13, -3), left: isTvMetrics() ? 0 : PHONE_HEADING_LEFT })
        .alignSelf(isTvMetrics() ? ItemAlign.Auto : ItemAlign.Start)
      Row({ space: this.pick(TV_CHOICE_GAP, PHONE_CHOICE_GAP) }) {
        ForEach(this.profiles, (profile: AvailableProfileResponse) => {
          Column() {
            ProfileAvatar({
              presetId: profile.is_current && this.avatarOverride !== '' ? this.avatarOverride : resolveAvatarPreset(profile.id),
              diameter: this.pick(TV_CHOICE_WIDTH, PHONE_CHOICE_WIDTH),
              initialFocus: profile.is_current,
              onSelect: () => {
                this.selectProfile(profile);
              },
            })
            Text(profile.display_name).fontFamily(nunito(700))
              .fontSize(this.pick(17.28, 12))
              .fontWeight(FontWeight.Bold)
              .fontColor(toResourceColor(activeColors().ink))
              .margin({ top: this.pick(6, 14) })
            Text(this.statusLabel(profile)).fontFamily(nunito(700))
              .fontSize(this.pick(9.408, 7.3))
              .fontWeight(FontWeight.Bold)
              .letterSpacing(this.pick(0.423, 0.33))
              .textCase(TextCase.UpperCase)
              .fontColor(toResourceColor(activeColors().inkSoft))
              .margin({ top: this.pick(9, 12) })
            if (profile.is_current) {
              Row({ space: tv(9) }) {
                this.tvActionButton($r('app.media.nav_settings'), '', BRAND_PINK, () => {
                  pushRoute(getNavStack(), ROUTES.Settings);
                })
                this.tvActionButton($r('app.media.action_sign_out'), 'Sign out', activeColors().inkSoft, () => {
                  this.handleSignOut();
                })
              }
              .margin({ top: tv(21) })
            }
          }
          .width(this.pick(TV_CHOICE_WIDTH, PHONE_CHOICE_WIDTH))
          .clip(false)
        }, (profile: AvailableProfileResponse): string => profile.id)
        // Web on TV: the tile opens the QR sign-in (/login/qr); a successful link returns to the picker.
        Column() {
          // Web `.profile-add`: the avatar gradient from surface-strong mixed 16% with the brand to #a82655,
          // under the avatar's top-left highlight, with a dashed ring.
          Stack() {
            Column()
              .width('100%')
              .height('100%')
              .linearGradient({ angle: 145, colors: [[TV_ADD_START, 0], [TV_ADD_END, 1]] })
            Column()
              .width('100%')
              .height('100%')
              .radialGradient({
                center: ['34%', '26%'],
                radius: this.pick(TV_CHOICE_WIDTH, PHONE_CHOICE_WIDTH) * 0.27,
                colors: [['rgba(255, 255, 255, 0.28)', 0], ['rgba(255, 255, 255, 0)', 1]],
              })
            Text('+').fontFamily(nunito(300))
              .fontSize(this.pick(76.8, 45))
              .fontWeight(FontWeight.Lighter)
              .fontColor(toResourceColor(activeColors().inkSoft))
          }
          .width(this.pick(TV_CHOICE_WIDTH, PHONE_CHOICE_WIDTH))
          .height(this.pick(TV_CHOICE_WIDTH, PHONE_CHOICE_WIDTH))
          .borderRadius(this.pick(TV_CHOICE_WIDTH, PHONE_CHOICE_WIDTH) / 2)
          .clip(true)
          .border({ width: 1, style: BorderStyle.Dashed, color: toResourceColorWithAlpha(activeColors().ink, 0.15) })
          Text($r('app.string.profiles_sign_in')).fontFamily(nunito(700))
            .fontSize(this.pick(17.28, 12))
            .fontWeight(FontWeight.Bold)
            .fontColor(toResourceColor(activeColors().inkSoft))
            .margin({ top: this.pick(9, 14) })
          Text($r('app.string.profiles_add_another_profile')).fontFamily(nunito(700))
            .fontSize(this.pick(9.408, 7.3))
            .fontWeight(FontWeight.Bold)
            .letterSpacing(this.pick(0.423, 0.33))
            .textCase(TextCase.UpperCase)
            .textAlign(TextAlign.Center)
            .fontColor(toResourceColor(activeColors().inkSoft))
            .margin({ top: this.pick(9, 12) })
        }
        .width(this.pick(TV_CHOICE_WIDTH, PHONE_CHOICE_WIDTH))
        .focusable(true)
        .onClick(() => {
          pushRoute(getNavStack(), ROUTES.Pairing);
        })
      }
      .alignItems(VerticalAlign.Top)
      .margin({ top: this.pick(TV_CHOICES_TOP - 242, PHONE_CHOICES_TOP), left: isTvMetrics() ? 0 : PHONE_CHOICES_LEFT })
      .alignSelf(isTvMetrics() ? ItemAlign.Auto : ItemAlign.Start)
      }
      .width('100%')
      .alignItems(HorizontalAlign.Center)
    }
    .width('100%')
    .height('100%')
  }

  /** A TV size scaled to the window, or the phone's own size (web phone profile picker). */
  private pick(tvSize: number, phoneSize: number): number {
    return isTvMetrics() ? tv(tvSize) : phoneSize;
  }

  private avatarDiameter(): number {
    return isTvMetrics() ? tv(TV_AVATAR_DIAMETER) : TOUCH_AVATAR_DIAMETER;
  }

  private focusScale(focusPercent: number): number {
    return 1 + (FOCUS_LIFT.button.scale - 1) * effectiveFocusPercent(focusPercent, DEFAULT_ACTIVE_RAIL_FACTOR);
  }

  private pinContinueEnabled(): boolean {
    return this.pinValue.length === PIN_LENGTH && !this.pinSubmitting;
  }

  build() {
    NavDestination() {
      // `activeColors()` is not tracked by ArkUI, so a theme change rebuilds the picker (keyed by the theme),
      // as Settings does; without it the picker stays in the old theme after Settings or the saved theme loads.
      Stack() {
        ForEach([this.themeSetting], (_theme: string) => {
          this.pageBody()
        }, (theme: string): string => theme)
      }
      .width('100%')
      .height('100%')
    }
    .hideTitleBar(true)
    .backgroundColor(toResourceColor(activeColors().bg))
  }

  @Builder
  private pageBody(): void {
      Stack() {
        if (this.viewState === ProfilesViewState.Ready && this.profiles.length > 0) {
          this.tvPicker()
        } else {
        Scroll() {
          Column({ space: Spacing.xl }) {
            Text($r('app.string.profiles_heading')).fontFamily(nunito(700))
              .fontSize(HEADING_FONT_SIZE)
              .fontWeight(FontWeight.Bold)
              .fontColor(toResourceColor(activeColors().ink))

            if (this.viewState === ProfilesViewState.Loading) {
              AsyncState({ kind: AsyncStateKind.Loading })
            } else if (this.viewState === ProfilesViewState.Error) {
              AsyncState({
                kind: AsyncStateKind.Error,
                message: this.errorMessage,
                retryLabel: 'Retry',
                retry: () => {
                  this.loadProfiles();
                },
              })
            } else if (this.profiles.length === 0) {
              // Defensive only -- brief 4.7 guarantees at least one entry
              // (the caller's own account) even under `AuthMode::FullAccount`.
              AsyncState({ kind: AsyncStateKind.Empty, message: 'No profiles are available.' })
            } else {
              Flex({ wrap: FlexWrap.Wrap, justifyContent: FlexAlign.Center, alignItems: ItemAlign.Center }) {
                ForEach(
                  this.profiles,
                  (profile: AvailableProfileResponse) => {
                    Column({ space: Spacing.sm }) {
                      ProfileAvatar({
                        presetId: resolveAvatarPreset(profile.id),
                        diameter: this.avatarDiameter(),
                        onSelect: () => {
                          this.selectProfile(profile);
                        },
                      })

                      Text(profile.display_name).fontFamily(nunito(400))
                        .fontSize(PROFILE_NAME_FONT_SIZE)
                        .fontColor(toResourceColor(activeColors().ink))

                      if (profile.is_current) {
                        Text($r('app.string.profiles_current_badge')).fontFamily(nunito(400))
                          .fontSize(PROFILE_STATUS_FONT_SIZE)
                          .fontColor(toResourceColor(activeColors().accent))
                      } else if (profile.pin_locked) {
                        Text($r('app.string.profiles_pin_locked_badge')).fontFamily(nunito(400))
                          .fontSize(PROFILE_STATUS_FONT_SIZE)
                          .fontColor(toResourceColor(activeColors().inkMuted))
                      }
                    }
                    .margin(TILE_MARGIN)
                  },
                  (profile: AvailableProfileResponse): string => profile.id
                )

                // No create-profile endpoint exists anywhere in the
                // contract (brief 4.7) -- this tile is a disabled
                // placeholder, not a call to an invented endpoint. Profile
                // management stays on Playarr Server's own admin surface.
                Column({ space: Spacing.sm }) {
                  Column() {
                    Text('+').fontFamily(nunito(400))
                      .fontSize(ADD_PROFILE_GLYPH_FONT_SIZE)
                      .fontColor(toResourceColor(activeColors().inkMuted))
                  }
                  .width(this.avatarDiameter())
                  .height(this.avatarDiameter())
                  .borderRadius(Radii.circleFull)
                  .backgroundColor(toResourceColor(activeColors().surfaceSoft))
                  .justifyContent(FlexAlign.Center)
                  .alignItems(HorizontalAlign.Center)

                  Text($r('app.string.profiles_add_profile')).fontFamily(nunito(400))
                    .fontSize(PROFILE_NAME_FONT_SIZE)
                    .fontColor(toResourceColor(activeColors().inkMuted))

                  Text($r('app.string.profiles_add_profile_hint')).fontFamily(nunito(400))
                    .fontSize(PROFILE_STATUS_FONT_SIZE)
                    .fontColor(toResourceColor(activeColors().inkMuted))
                    .textAlign(TextAlign.Center)
                    .constraintSize({ maxWidth: this.avatarDiameter() + Spacing.xl })
                }
                .margin(TILE_MARGIN)
                .opacity(0.6)
                .enabled(false)
              }
              .width('100%')
            }

            Row({ space: Spacing.md }) {
            // Web `.profile-settings-button`: a round gear in the selected profile's actions, opening Settings.
            Stack() {
              Image($r('app.media.nav_settings'))
                .width(SETTINGS_ICON_SIZE)
                .height(SETTINGS_ICON_SIZE)
                .colorFilter(tintFilter(BRAND_PINK))
            }
            .width(SETTINGS_BUTTON_SIZE)
            .height(SETTINGS_BUTTON_SIZE)
            .borderRadius(SETTINGS_BUTTON_SIZE / 2)
            .backgroundColor(toResourceColorWithAlpha(activeColors().surfaceStrong, 0.7))
            .border({ width: 1, color: toResourceColorWithAlpha(activeColors().ink, 0.15) })
            .focusable(true)
            .onClick(() => {
              pushRoute(getNavStack(), ROUTES.Settings);
            })
            Button($r('app.string.sign_out'))
              .fontSize(PROFILE_NAME_FONT_SIZE)
              .fontWeight(FontWeight.Bold)
              .fontColor(toResourceColor(activeColors().onAccent))
              .backgroundColor(toResourceColor(activeColors().accent))
              .borderRadius(Radii.btn)
              .padding({ left: Spacing.lg, right: Spacing.lg, top: Spacing.sm, bottom: Spacing.sm })
              .focusable(true)
              .onFocus(() => {
                this.setSignOutFocused(true);
              })
              .onBlur(() => {
                this.setSignOutFocused(false);
              })
              .scale({ x: this.focusScale(this.signOutFocusPercent), y: this.focusScale(this.signOutFocusPercent) })
              .onClick(() => {
                this.handleSignOut();
              })
            }
          }
          .width('100%')
          .padding(Spacing.xl)
          .alignItems(HorizontalAlign.Center)
        }
        .width('100%')
        .height('100%')
        }

        if (this.pinTargetProfile !== null) {
          Stack({ alignContent: Alignment.Center }) {
            Column()
              .width('100%')
              .height('100%')
              .backgroundColor(toResourceColorWithAlpha({ r: 0, g: 0, b: 0, a: 1 }, MODAL_SCRIM_ALPHA))

            Column({ space: Spacing.md }) {
              ProfileAvatar({
                presetId: resolveAvatarPreset(this.pinTargetProfile.id),
                diameter: PIN_DIALOG_AVATAR_DIAMETER,
                onSelect: () => {},
              })

              Text($r('app.string.profiles_pin_title')).fontFamily(nunito(700))
                .fontSize(PIN_TITLE_FONT_SIZE)
                .fontWeight(FontWeight.Bold)
                .fontColor(toResourceColor(activeColors().ink))

              Text(this.pinTargetProfile.display_name).fontFamily(nunito(400))
                .fontSize(SUBHEADING_FONT_SIZE)
                .fontColor(toResourceColor(activeColors().inkSoft))

              TextInput({ text: this.pinValue, placeholder: '0000' })
                .type(InputType.Number)
                .maxLength(PIN_LENGTH)
                .textAlign(TextAlign.Center)
                .width(PIN_INPUT_WIDTH)
                .onChange((value: string) => {
                  this.onPinDigitsChange(value);
                })

              if (this.pinError.length > 0) {
                Text(this.pinError).fontFamily(nunito(400))
                  .fontSize(PROFILE_STATUS_FONT_SIZE)
                  .fontColor(toResourceColor(activeColors().danger))
              }

              Row({ space: Spacing.md }) {
                Button($r('app.string.cancel'))
                  .fontSize(PROFILE_NAME_FONT_SIZE)
                  .fontColor(toResourceColor(activeColors().ink))
                  .backgroundColor(toResourceColor(activeColors().surfaceStrong))
                  .borderRadius(Radii.drawerButton)
                  .padding({ left: Spacing.lg, right: Spacing.lg, top: Spacing.sm, bottom: Spacing.sm })
                  .focusable(true)
                  .onFocus(() => {
                    this.setPinCancelFocused(true);
                  })
                  .onBlur(() => {
                    this.setPinCancelFocused(false);
                  })
                  .scale({ x: this.focusScale(this.pinCancelFocusPercent), y: this.focusScale(this.pinCancelFocusPercent) })
                  .onClick(() => {
                    this.closePinPrompt();
                  })

                Button($r('app.string.profiles_pin_continue'))
                  .fontSize(PROFILE_NAME_FONT_SIZE)
                  .fontWeight(FontWeight.Bold)
                  .fontColor(toResourceColor(activeColors().onAccent))
                  .backgroundColor(toResourceColor(activeColors().accent))
                  .borderRadius(Radii.drawerButton)
                  .padding({ left: Spacing.lg, right: Spacing.lg, top: Spacing.sm, bottom: Spacing.sm })
                  .enabled(this.pinContinueEnabled())
                  .focusable(true)
                  .onFocus(() => {
                    this.setPinContinueFocused(true);
                  })
                  .onBlur(() => {
                    this.setPinContinueFocused(false);
                  })
                  .scale({ x: this.focusScale(this.pinContinueFocusPercent), y: this.focusScale(this.pinContinueFocusPercent) })
                  .onClick(() => {
                    this.submitPin();
                  })
              }
              .width('100%')
              .justifyContent(FlexAlign.Center)
            }
            .width(PIN_DIALOG_WIDTH)
            .padding(Spacing.xl)
            .backgroundColor(toResourceColor(activeColors().surface))
            .borderRadius(Radii.railPanel)
            .alignItems(HorizontalAlign.Center)
          }
          .width('100%')
          .height('100%')
        }
      }
      .width('100%')
      .height('100%')
      // On the rebuilt Stack: the NavDestination's own background does not repaint on a theme change.
      .backgroundColor(toResourceColor(activeColors().bg))
  }
}

/**
 * Registered in `profile/router_map.json` as the `Profiles` route's
 * `buildFunction` -- same zero-parameter passthrough pattern
 * `pages/Index.ets`'s `IndexBuilder` and `pages/DesignGallery.ets`'s
 * `DesignGalleryBuilder` already establish, since `Profiles` (per
 * `navigation/Routes.ets` / `navigation/NavStack.ets`) is one of the
 * routes pushed/replaced with no navigation parameters.
 */
@Builder
export function ProfilesBuilder(): void {
  Profiles()
}
