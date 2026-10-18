# Parity testing

Which ways each platform vendor lets you run a client, and how to start each one.

> **Native parity is ON HOLD** until the owner is happy with the web client. The web client is the source of truth
> (`docs/parity/README.md`): native clients are matched to it, never the other way round.

The matrix lists what each **platform vendor supports or offers**: capability only, not what we have set up. Columns are
only the ways to *run* the client. Taking screenshots and driving input work in every run environment, so they are not
columns; the tool for driving input on each platform is named in the notes.

Legend: ✅ the vendor supports it. ❌ the vendor does not offer it (none found). ⚠️ limited (see the note). ❓ unverified
(could not be confirmed from an official source). Numbers refer to the notes below.

## Matrix

| Client | Browser | Emulator | Simulator | Real device (dev mode or sideload) |
| --- | --- | --- | --- | --- |
| Web client (TV and mobile layouts) | ✅ [1] | ❌ | ⚠️ DevTools and Playwright device emulation [1] | ✅ [1] |
| Android TV | ❌ | ✅ [2] | ❌ | ✅ [2] |
| Android phone | ❌ | ✅ [2] | ❌ | ✅ [2] |
| Fire TV, Vega OS | ❌ | ✅ [3] | ❌ | ✅ [3] |
| Fire TV, legacy Fire OS (Android based) | ❌ | ⚠️ [4] | ❌ | ✅ [4] |
| iOS | ❌ | ❌ | ✅ [5] | ✅ [5] |
| tvOS (Apple TV) | ❌ | ❌ | ✅ [5] | ✅ [5] |
| Roku | ❌ | ❌ | ❌ | ✅ [6] |
| Samsung Tizen | ❌ | ✅ [7] | ✅ [7] | ✅ [7] |
| LG webOS | ❌ | ⚠️ [8] | ✅ [8] | ✅ [8] |
| Hisense VIDAA | ❌ [9] | ❓ [9] | ❓ [9] | ✅ [9] |
| Xbox | ❌ | ❌ | ❌ | ✅ [10] |
| HarmonyOS | ❌ | ✅ [11] | ⚠️ Previewer [11] | ✅ [11] |

## Notes (vendor support, with official sources)

1. **Web.** Every desktop browser runs the client. Playwright device emulation sets viewport, user agent and touch to
   mimic a phone or tablet, but it is not a real mobile engine
   ([Playwright emulation](https://playwright.dev/docs/emulation)). Any real phone or TV browser also runs it. Input:
   Playwright. The TV web shells (Tizen, webOS, VIDAA) reuse the web client.
2. **Android phone and Android TV.** The Android Emulator takes a phone or an Android TV hardware profile and system
   image ([Android TV emulator](https://developer.android.com/training/tv/start/start),
   [create and manage virtual devices](https://developer.android.com/studio/run/managing-avds)). Real devices use USB
   debugging from Developer options (same TV page). Input: `adb` ([adb](https://developer.android.com/tools/adb)).
3. **Fire TV on Vega OS.** Amazon's Vega SDK ships a **Vega Virtual Device** started with `vega virtual-device start` and
   run with `vega run-app`; Amazon's docs call it a virtual device, and some of its wording calls it a simulator
   ([run your app](https://developer.amazon.com/docs/vega/0.24/run-apps),
   [guide to building for Fire TV on Vega OS](https://developer.amazon.com/apps-and-games/blogs/2026/07/guide-to-building-for-fire-tv-on-vega-os)).
   Its build must match the host architecture. Amazon recommends real hardware for production-ready checks. Real device:
   Developer Mode on the Fire TV, then `vega devmode login`, `vega devmode enable-device`, `vega device install-app`.
   Input: the Vega CLI; on the virtual device, `inputd-cli` (full command set after `vsm developer-mode enable`).
4. **Legacy Fire OS.** Android based, so the Android emulator and `adb` apply. An Amazon-specific emulator image: ❓
   unverified. Reference only.
5. **iOS and tvOS.** Xcode includes iPhone and Apple TV simulators; a real device needs a development signing team, and Developer Mode
   on iOS ([running in Simulator or on a device](https://developer.apple.com/documentation/xcode/running-your-app-in-simulator-or-on-a-device)).
   Input: XCUITest, `xcrun simctl`.
6. **Roku.** No emulator or simulator; testing is on physical devices only
   ([automated channel testing](https://developer.roku.com/docs/developer-program/dev-tools/automated-channel-testing/automated-testing-overview.md)).
   Real device: Developer Mode, sideload through the developer installer. Input: ECP, or the Roku WebDriver server (needs
   Roku OS 9.1 or later, addresses the device by IP, translates to ECP).
7. **Samsung Tizen.** Tizen Studio's TV Extension (10.0.0, released 26 February 2026) provides the **TV Emulator**, which
   needs CPU virtualisation and at least 1024 MB RAM, and is slower than a real TV; 4K video, DRM and some Samsung APIs
   are unsupported ([TV emulator](https://developer.samsung.com/tv/develop/getting-started/using-sdk/tv-emulator),
   [release history](https://developer.samsung.com/smarttv/develop/tools/tv-extension/release-history.html)). The **TV
   Simulator** is lighter, uses a different web engine from the TV and emulator, and does not support hardware-bound APIs
   ([TV Simulator](https://developer.samsung.com/tv/develop/getting-started/using-sdk/tv-simulator)). Real TV: Developer
   Mode ([TV device](https://developer.samsung.com/tv/develop/getting-started/using-sdk/tv-device)). Debugging and input:
   Web Inspector and the virtual remote ([Web Inspector](https://developer.samsung.com/SmartTV/develop/getting-started/using-sdk/web-inspector.html)).
8. **LG webOS.** The **webOS TV Emulator** (VirtualBox 6.1, at least 3 GB RAM) is deprecated and not provided for webOS
   TV 22 and later; Apple silicon unsupported ([emulator](https://webostv.developer.lge.com/develop/tools/emulator-installation)).
   The **webOS TV Simulator** runs on a PC with the TV's Chromium version, web apps only, with no DRM and different media
   behaviour ([simulator](https://webostv.developer.lge.com/develop/tools/simulator-introduction)). Real TV: Developer
   Mode app from the LG Content Store. Input and debugging: the `ares-*` CLI
   ([CLI introduction](https://webostv.developer.lge.com/develop/tools/webos-tv-cli-introduction)).
9. **VIDAA.** Run and test on a real Hisense VIDAA TV: Playarr is installed and signed in on one. Install by sideloading
   the hosted web client's URL through the TV's browser debug install page (third-party guide, unofficial). Debug with the
   TV's remote-debugging mode. No public emulator or simulator found, so both are ❓ unverified. A desktop browser is not a
   vendor method.
10. **Xbox.** The client is the Xbox app (`clients/xbox`, a UWP/XAML app). It runs only on Xbox: Dev Mode turns any
   retail console into a development console, and Visual Studio deploys the app over the network with a signed-in user
   ([activation](https://learn.microsoft.com/windows/uwp/xbox-apps/devkit-activation),
   [environment setup](https://learn.microsoft.com/en-us/windows/uwp/xbox-apps/development-environment-setup)). No Xbox
   emulator or simulator found. Windows Device Portal on Xbox: ❓ unverified.
11. **HarmonyOS.** DevEco Studio provides an emulator, driven from the CLI too
   ([emulator CLI](https://developer.huawei.com/consumer/en/doc/harmonyos-guides/ide-emulator-command-line)), and real
   devices over USB or wireless debugging with `hdc`
   ([developer mode](https://developer.huawei.com/consumer/en/doc/harmonyos-guides/ide-developer-mode)). The Previewer is a
   UI preview, not a full run. Remote emulator access reportedly needs a verified Huawei account and is time-limited
   (third-party report); availability outside China: ❓ unverified.

## How to run each

| What | Command or path | Runs on |
| --- | --- | --- |
| Web unit tests | `pnpm --filter @playarr-tv/web run test` (from `clients/tv-web`) | CI, local |
| Browser, parity, capture and device runs | see `docs/testing/local-device-tests.md` (never in CI) | local |
| Web parity references | `node scripts/parity/capture-web.mjs` (see `docs/parity/README.md`) | local |
| Diff native against web | `node scripts/parity/diff.mjs --ref docs/parity/web --cand <dir> --layout tv --theme dark` | local |
| Fixture server | `scripts/fixtures/up.sh --fresh` (`down.sh` to stop) | local |
| Android build and tests | `./gradlew build` in `clients/android` | CI, local |
| Android TV parity | `scripts/parity/android-tv/capture.sh <out> <light\|dark>` | workstation emulator or real TV |
| Android phone parity | `scripts/parity/android-mobile/capture.sh` | local emulator |
| Fire TV | `npm test -- --ci` in `clients/fire-tv`; `scripts/parity/fire-tv/capture.sh` | CI; real device |
| tvOS live simulator | the MacBook launchd agent `app.playarr.sim-live`, reached over ssh (no repository workflow) | MacBook |
| Simulator VNC | `scripts/sim-vnc/sim_vnc.py`; tests `python3 scripts/sim-vnc/test_sim_vnc.py` | MacBook, runner |
| Roku | `make deploy` in `clients/roku`; `scripts/parity/roku/capture.mjs` | real device |
| Xbox core | `dotnet test tests/Playarr.Core.Tests/Playarr.Core.Tests.csproj` in `clients/xbox` | CI, local |
| HarmonyOS checks | `node scripts/validate.mjs`; `node tools/run-core-tests.mjs` in `clients/harmony` | CI, local |

## Static parity server

Web refs and device captures used to hit a live server, so Recently Added, On deck, watch progress, the watchlist, the
calendar and the avatar drifted between runs. The static parity server serves one frozen, seeded library instead.

    scripts/parity/static-server.sh            # builds what is missing, then serves until Ctrl-C
    scripts/parity/static-server.sh --build    # build only

- **URL and account:** `scripts/parity/parity.env` (`PARITY_SERVER_URL`, built from this host's LAN address (detected, never committed) and a fixed port, so real TVs and
  phones reach it; `PARITY_ACCOUNT_NAME`). The password is `PLAYARR_PARITY_STATIC_PASSWORD` in `~/.secrets`, never in the
  repo. The web client is served at `<url>/tv`. The clock is `screens.json` `determinism.clock`, exported as `PARITY_CLOCK`.
- **Content:** built from scratch by `scripts/parity/static/build-db.mjs` from `static/catalogue.mjs`: 30 films, 20 series with
  seasons and episodes, 6 artists with albums, three profiles (`parity`, `parity-kids`, `parity-guest`, fixed avatars), fixed added
  dates, a fixed watchlist, calendar entries around the clock, and a deck of exactly the canonical On deck item. Artwork is
  generated from the title text and a fixed colour pair; there is one 60 s playable clip. It is never a copy of a live DB.
- **Frozen:** every start copies the pristine DB to a throw-away working directory. `PLAYARR_STATIC=1` stops arr and peer sync,
  relay registration, ACME, backups, metadata refresh, the folder scanner, the calendar refresher and the Dubarr poller. The
  backend runs in a cgroup (`MemoryHigh=8G`, `MemoryMax=12G`, `MemorySwapMax=512M`).
- **Scripts:** every node capture script loads `parity.env` through `dpad-account.mjs`, and `readSecrets()` then answers the
  Device Test and per-client parity accounts with the static server and account. `PARITY_LIVE=1` switches that off. Shell
  scripts use `eval "$(node scripts/parity/parity-config.mjs --shell)"`.
- **Not wired (still name a server or the Device Test account themselves):** `scripts/xbox-wall/pair.py`,
  `scripts/apple-wall/*` (`login.py`, `wall.sh`, `fixture-server-preflight.mjs`), `scripts/harmony-wall/*.py`,
  `scripts/vidaa/receiver.py`, `scripts/sim-vnc/seed_session.py`, `scripts/appletv-parity-suite.mjs`,
  `scripts/parity/capture-web-scrolled.mjs` (fixture account), `scripts/parity/android-mobile/capture.{sh,py}` (fixture
  account) and `scripts/parity/android-mobile/tablet/cap.sh`. They need the same two values by hand.
- **Native apps:** each app is pointed at the static server on the device itself, with its own server field or pairing flow: Android
  (TV and phone) and Fire TV: server field on the sign-in screen (`android-tv/capture.sh` types it); iOS, tvOS: server field
  (`TVAppEnvironment.swift`, the simulator driver passes it); Tizen, webOS, VIDAA: the hosted web client's server field or the link
  page of the static server (`<url>/tv/link`); Roku, Xbox, HarmonyOS, Sailfish, Linux mobile: their own sign-in or pairing screen.
  The device must reach the host's LAN address (an Android emulator reaches it through its NAT).
