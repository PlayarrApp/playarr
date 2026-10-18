/**
 * Device-link ("pairing") screen: RFC 8628 device authorisation (brief
 * section 4.3, and section 9 "Slice 5" acceptance). Drives
 * `auth/DeviceAuthService.ets`'s two-step API end to end: one
 * `requestDeviceCode()` call, then `beginPolling(...)` on the schedule
 * `core/DeviceCodePolicy.ts` computes, until a terminal outcome arrives.
 *
 * `pages/*.ets` may never import `net/` or `auth/` directly (brief section
 * 3.1's layer rule, enforced by `checks/arkts.mjs`'s Check 4), so this file
 * never imports `auth/DeviceAuthService.ets` itself -- it calls
 * `AppContainer#getDeviceAuthService()` instead (see that file's own header
 * comment for why that getter exists). Every value this page reads back off
 * `requestDeviceCode()`/`beginPolling()` (the `ApiResult` success/failure
 * discriminant, the error envelope's own `kind`, the poll outcome's own
 * `kind`) is narrowed purely by comparing `.kind` against a string literal,
 * never by importing `net/ApiResult.ets`'s or `auth/DeviceAuthService.ets`'s
 * own type names -- TypeScript infers every one of those shapes from
 * `DeviceAuthService`'s declared return types without this file ever having
 * to spell them.
 *
 * Four visible states (brief 9's own vocabulary): "checking" (the initial
 * `requestDeviceCode()` call is in flight), "waiting" (a code was issued and
 * `beginPolling()` is running) and "error" (a network failure, a server
 * error, or the approving device declined the request). An expired code is
 * not a state: like web, the page silently requests a fresh code. `design/components/AsyncState.ets`
 * renders "checking" and "error" (its `Loading` and `Error` kinds
 * respectively); "waiting" is this page's own layout, since it has real
 * content to show (the code, the address, the completion URL) alongside a
 * small `AsyncState` `Loading` spinner, not a single full-screen state.
 *
 * QR: the code shows as a QR of `verification_uri_complete` (ArkUI `QRCode`) beside the web layout's instructions. With no
 * server configured the page uses the hosted link broker (`requestHostedLink`/`beginHostedPolling`), so the QR path never
 * asks for a typed server address; "Sign in manually" is the separate fallback to `ServerSetup`.
 *
 * On the TV profile (`device/DeviceProfileService.ets`'s published
 * `DeviceProfile.inputMode === 'dpad'`), `getUIContext().getFocusController()
 * .activate(true, false)` runs in `aboutToAppear()`, before the first frame,
 * per brief section 6.3 -- otherwise the focus ring stays hidden and the
 * first D-pad press appears to do nothing.
 *
 * On success, this page calls `NavStack#replaceRoute` (never `pushRoute`) to
 * land on `Profiles`, so Back from `Profiles` does not return to a
 * now-consumed pairing code.
 */

import { nunito } from '../design/Typography';
import { getDeviceAuthService, getServerDirectory } from '../AppContainer';
import { Spacing, Radii } from '../core/Tokens';
import type { DeviceCodeResponse } from '../core/Types/Auth';
import type { DeviceProfile } from '../core/DeviceProfile';
import { DEVICE_PROFILE_STORAGE_KEY } from '../device/DeviceProfileService';
import { activeColors, toResourceColor } from '../design/Theme';
import type { ThemeModeSetting } from '../design/Theme';
import { AsyncState, AsyncStateKind } from '../design/components/AsyncState';
import { ROUTES } from '../navigation/Routes';
import { getNavStack, pushRoute, replaceRoute } from '../navigation/NavStack';
import { logWarn } from '../util/Log';
import { t } from '../core/Language';

/** brief 9 ("Slice 5" acceptance): "renders the user_code at display size
 * with wide letter-spacing". Not a `core/Tokens.ts` field -- that table has
 * no typography scale at all (see `design/components/FeatureCopy.ets`'s own
 * header comment on that) -- so these are named constants here, the same
 * documented exception `design/components/AsyncState.ets`'s `SPINNER_*`
 * constants and `design/Motion.ets`'s `SPINNER_ROTATION_MS` both take. The
 * brief gives no exact figures for this screen, so the values below are
 * this file's own reasonable choice for "display size" / "wide". */
const USER_CODE_FONT_SIZE: number = 56;
const USER_CODE_LETTER_SPACING: number = 8;
const QR_SIZE: number = 240;
const QR_GAP: number = 48;

/** The four states this screen's own acceptance criteria name. "success" is
 * deliberately not a rendered state -- `handleOutcome` below navigates away
 * the same tick it is reached, so there is nothing meaningful to paint. */
type PairingPhase = 'checking' | 'waiting' | 'error';

@Component
struct Pairing {
  // Tracked purely to force a re-render on theme change; see
  // design/Theme.ets's own header comment for this exact pattern.
  @StorageProp('colorMode') private sysColorMode: ColorMode = ColorMode.LIGHT;
  @StorageProp('themeModeSetting') private themeSetting: ThemeModeSetting = 'system';

  @State private phase: PairingPhase = 'checking';
  @State private deviceCode: DeviceCodeResponse | null = null;
  @State private errorMessage: string = '';

  // Plain (non-reactive) field: a cancel callback for whichever poll loop is
  // currently in flight, or null while none is. Deliberately typed as a
  // closure rather than the real `DeviceAuthHandle` interface `beginPolling`
  // returns, so this file never has to name (and therefore never has to
  // import) a type declared in `auth/DeviceAuthService.ets`.
  private cancelPolling: (() => void) | null = null;

  aboutToAppear(): void {
    const profile = AppStorage.get<DeviceProfile>(DEVICE_PROFILE_STORAGE_KEY);
    if (profile !== undefined && profile.inputMode === 'dpad') {
      // brief section 6.3: the focus ring is hidden by default, and the
      // first D-pad press appears to do nothing until this runs. Must
      // happen before the first frame, so it belongs here rather than in
      // any click/focus handler.
      this.getUIContext().getFocusController().activate(true, false);
    }
    this.startPairing();
  }

  aboutToDisappear(): void {
    this.cancelActivePoll();
  }

  private cancelActivePoll(): void {
    if (this.cancelPolling !== null) {
      this.cancelPolling();
      this.cancelPolling = null;
    }
  }

  private restart(): void {
    this.startPairing();
  }

  private async startPairing(): Promise<void> {
    this.cancelActivePoll();
    this.phase = 'checking';
    this.errorMessage = '';
    this.deviceCode = null;

    const service = getDeviceAuthService();
    // No server yet: link through the hosted broker, so nobody types a server address.
    const hosted = getServerDirectory().getActiveBaseUrl() === null;
    const result = await service.requestPairingCode(hosted);

    if (result.kind === 'network_failure') {
      this.phase = 'error';
      this.errorMessage = 'Could not reach the server. Check your connection and try again.';
      return;
    }

    if (result.kind === 'http_failure') {
      this.phase = 'error';
      const envelope = result.envelope;
      if (envelope.kind === 'general') {
        this.errorMessage = envelope.message;
      } else if (envelope.kind === 'upgrade_required') {
        this.errorMessage = 'This app is out of date. Update Playarr and try again.';
      } else {
        this.errorMessage = 'Something went wrong. Try again.';
      }
      return;
    }

    // result.kind === 'ok'
    const response = result.value;
    this.deviceCode = response;
    this.phase = 'waiting';

    const handle = service.beginPairing(hosted, response, (outcome): void => {
      if (outcome.kind === 'success') {
        this.cancelPolling = null;
        replaceRoute(getNavStack(), ROUTES.Profiles);
        return;
      }
      if (outcome.kind === 'cancelled') {
        return;
      }
      this.cancelPolling = null;
      if (outcome.kind === 'expired') {
        // Web parity (rows 14.770, 14.772): renew silently, no error, no button.
        this.startPairing();
        return;
      }
      if (outcome.kind === 'access_denied') {
        this.phase = 'error';
        this.errorMessage = 'Pairing was declined on the other device.';
        return;
      }
      // outcome.kind === 'request_failed'
      this.phase = 'error';
      this.errorMessage = outcome.message;
      logWarn('Pairing', 'device pairing poll failed: ' + outcome.message);
    });
    this.cancelPolling = (): void => {
      handle.cancel();
    };
  }

  build() {
    NavDestination() {
      Column({ space: Spacing.xl }) {
        Text($r('app.string.pairing_title')).fontFamily(nunito(700))
          .fontSize(24)
          .fontWeight(FontWeight.Bold)
          .fontColor(toResourceColor(activeColors().ink))
          .textAlign(TextAlign.Center)

        if (this.phase === 'checking') {
          AsyncState({ kind: AsyncStateKind.Loading })
        } else if (this.phase === 'error') {
          AsyncState({
            kind: AsyncStateKind.Error,
            message: this.errorMessage,
            retryLabel: t('components.deviceLogin.tryAgain', 'Try again'),
            retry: (): void => {
              this.restart();
            },
          })
        } else if (this.deviceCode !== null) {
          Row({ space: QR_GAP }) {
            QRCode(this.deviceCode.verification_uri_complete)
              .width(QR_SIZE)
              .height(QR_SIZE)
              .color('#000000')
              .backgroundColor('#FFFFFF')
              .focusable(false)

            Column({ space: Spacing.sm }) {
              Text('Scan the QR code, or visit').fontFamily(nunito(400))
                .fontSize(18)
                .fontColor(toResourceColor(activeColors().inkSoft))
              Text(this.deviceCode.verification_uri).fontFamily(nunito(700))
                .fontSize(24)
                .fontWeight(FontWeight.Bold)
                .fontColor(toResourceColor(activeColors().ink))
              Text('and enter this code').fontFamily(nunito(400))
                .fontSize(18)
                .fontColor(toResourceColor(activeColors().inkSoft))
              Text(this.deviceCode.user_code).fontFamily(nunito(700))
                .fontSize(USER_CODE_FONT_SIZE)
                .fontWeight(FontWeight.Bold)
                .letterSpacing(USER_CODE_LETTER_SPACING)
                .fontColor(toResourceColor(activeColors().ink))
              Text($r('app.string.pairing_waiting')).fontFamily(nunito(400))
                .fontSize(16)
                .fontColor(toResourceColor(activeColors().inkMuted))
            }
            .alignItems(HorizontalAlign.Start)
          }
          Button(t('components.deviceLogin.signInManually', 'Sign in manually'))
            .defaultFocus(true)
            .onClick((): void => {
              this.cancelActivePoll();
              pushRoute(getNavStack(), ROUTES.ServerSetup);
            })
        }
      }
      .width('100%')
      .height('100%')
      .padding(Spacing.xl)
      .justifyContent(FlexAlign.Center)
      .alignItems(HorizontalAlign.Center)
      .backgroundColor(toResourceColor(activeColors().bg))
    }
    .hideTitleBar(true)
  }
}

/**
 * Registered in `profile/router_map.json` as the `Pairing` route's
 * `buildFunction`, matching `pages/Index.ets#IndexBuilder`'s own
 * zero-parameter convention for a page with no navigation params (see
 * `navigation/Routes.ets`: `Pairing` carries no param interface).
 */
@Builder
export function PairingBuilder(): void {
  Pairing()
}
