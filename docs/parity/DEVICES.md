# Parity devices: how each one is run and tested

Every device is scored by the shared suite (`SUITE.md`) against the web reference and shown on the device wall legend.
Captures go to `<legend dir>/<cand>/<theme>/<screen>.png`; the TV reference is web TV at 1920x1080, the mobile
reference is web mobile at the device's own size. The legend dir is the client's folder under the parity scratch area
(host paths are not recorded here). Host names, addresses and credentials never appear in this repository.

## TV (reference: web TV, 1920x1080)

| Device | How it runs | How it is driven | How captures are taken | Known limits | Legend dir |
| --- | --- | --- | --- | --- | --- |
| Web TV (reference) | Chromium in Playwright, TV user agent | Keyboard arrows, Enter, Escape (`drivers/web.mjs`) | Playwright page screenshot | None: it is the source of truth | `web` |
| Android TV | Android Emulator, TV image | `adb shell input keyevent` D-pad keys | `adb exec-out screencap` | No hardware video plane; software codecs | `android` |
| Fire TV (Vega OS) | Vega virtual device | Vega CLI, `inputd-cli` key events | Virtual device screenshot | Build must match the host architecture; older Fire OS runs the Android TV app | `firetv` |
| Apple TV | tvOS simulator | `xcrun simctl` and XCUITest remote presses | `xcrun simctl io screenshot` | Simulator video is not the device decoder | `apple` |
| Samsung Tizen | Tizen TV emulator 10.0 under KVM with host GPU GL, signed with an owner-provided Samsung certificate profile | X key events to the emulator window; the debug build's `netlog.js` channel evaluates page code (`drivers/tizen-webos.mjs`, `DEVICE=tizen`) | Emulator screen grab (`xwd`) | No 4K, DRM or some Samsung APIs; the video plane is a native AVPlay overlay the screen grab cannot see | `tizen-webos` (cand `tizen`) |
| Samsung Tizen (native) | The native Tizen .NET app (`clients/tizen-native`, debug build) on the Tizen TV emulator | `drivers/tizen-native.mjs`: debug mirror keys over `sdb forward` | `import -window root` of the emulator display | No 4K, DRM or some Samsung APIs; same emulator as the web package | `tizen-native` (cand `dev`) |
| LG webOS | webOS TV 23 Simulator (Chromium 94) under a virtual X display | Chrome DevTools Protocol key events and page evaluation (`drivers/tizen-webos.mjs`, `DEVICE=webos`) | Screen grab (`xwd`) | Simulator only; no real panel or decoder; see the documented exceptions below | `tizen-webos` (cand `webos`) |
| HarmonyOS TV | DevEco Previewer (images are region-locked) | Previewer key input | Previewer screenshot | Previewer renders UI only: no real playback | `harmony` |
| Xbox | UWP app in a Windows VM cloned from the runner (runner disabled) | Gamepad D-pad through the VM | VM screen capture | VM has no real console video path; on-screen keyboard for text | `xbox` |
| macOS (Apple TV app) | The Apple TV app on a Mac, inside its own simulator folder only | Keyboard arrows | Window capture, never the desktop | Muted; never stream or capture the desktop | `macos` |
| Hisense VIDAA | Real TV: MQTT remote plus the debug mirror build | MQTT remote key messages | Debug mirror build screenshots | Hardware only, no emulator | `vidaa` (pending) |
| Roku Streaming Stick 4K | Real device, developer mode | ECP key presses | `plugin_inspect` screenshots | No emulator; screenshot has no video plane | `roku` (pending) |

### Tizen and webOS: how the shared runs work

- Both devices run the same page code, so `drivers/tizen-webos.mjs` is one driver with two transports. Tizen needs a debug
  build (the clean dist plus `scripts/parity/tizen-webos/netlog.js` loaded first) and the host log sink
  `scripts/parity/tizen-webos/logserver.py <dir>/log.txt`; point the driver at `<dir>` with `PARITY_NETLOG`. Restore the
  clean build after a run.
- Tizen key presses are X key events (`xclick.py`). A long press needs X autorepeat off on the display (`xset r off`,
  which the driver does), or the repeats cancel the long-press timer and the press becomes a click.
- Light and dark captures go to `<cand>/dark` (or `<cand>` itself) and `<cand>/light`, with the web references in
  `web` and `web/light`, as the legend expects.
- Search is captured with the on-screen keyboard dismissed and player-controls with the video plane hidden, on web and
  device alike: the keyboard is platform UI and the video plane is a native overlay, neither is app output.
- Playback is judged as playing when the playhead advances by `advanceSeconds` within `advanceSeconds + 6` s of wall
  clock; a fixed 3 s window of a stream that is still buffering fails even on web.
- Home rails depend on the shared account's recent activity (other clients play and mark items), so run the web
  reference and the device checks straight after each other; a Home check that differs only in the first card is drift,
  not a D-pad bug.

### webOS documented exceptions (not chased)

These are engine or simulator effects of the webOS TV 23 Simulator, not Playarr code. The webOS score is reported with
this note.

- **Forced font weight.** The simulator injects `* { font-weight: 400 !important }` (Electron `insertCSS`), so bold
  text renders lighter than on web. An app rule cannot restore the per-element weights against an `!important` universal
  rule. Not verified on a real TV.
- **Date comma.** Chromium 94's ICU (CLDR) formats the en-GB clock date as "SUN, 11 OCTOBER", web (Chromium 120) as
  "SUN 11 OCTOBER".
- **On-screen keyboard.** A focused text field opens the platform keyboard; the suite captures search with it dismissed.

## Mobile (gated by 17.10022; reference: web mobile at the device's size)

Mobile devices have no D-pad: they run the screen and theme captures and the playback cases, and the legend shows the
D-pad column as n/a.

| Device | How it runs | How it is driven | How captures are taken | Known limits | Legend dir |
| --- | --- | --- | --- | --- | --- |
| iPhone | iOS simulator | `xcrun simctl`, XCUITest taps | `xcrun simctl io screenshot` | Simulator video only | `ios-phone` |
| iPad | iOS simulator (iPad) | As iPhone | As iPhone | Own size; compared with web mobile at that size | `ios-tablet` |
| Android phone | Android Emulator, phone image | `adb shell input` | `adb exec-out screencap` | Software codecs | `android-phone` |
| HarmonyOS phone | DevEco Previewer | Previewer input | Previewer screenshot | UI only, no real playback | `harmony-phone` |
| Sailfish OS | Sailfish SDK emulator (VirtualBox on KVM) | `scripts/parity/sailfish/driver.mjs`: app smoke-script hook over ssh, no D-pad | Display capture over VNC | Slow; software GL; touch phone, so the D-pad checks are not passed | `sailfish` |
| Nura (postmarketOS) | `pmbootstrap` qemu-amd64 | QEMU input | QEMU screendump | Slow; software rendering | `postmarketos` |

## Legend and build.json rules

- After every capture run, unmerged branches included, write captures to the legend dir, refresh `web/` in the same
  run and write `<cand>/build.json` `{ "branch", "sha", "pr", "captured_at" }`. A branch other than `main` shows
  the UNMERGED badge.
- Never publish an error or signed-out screen as a capture: abort instead (the suite runner does).
- The device test account, "Device Test" profile, is signed in on Home, dark by default.
- Result files `dpad.json` and `playback.json` sit beside the captures (schema in `SUITE.md`).
- The score per client: Dark % and Light % are the mean per-screen similarity over the screens captured in that theme;
  D-pad is checks passed of 11 and playback is cases passed of 3; overall is the mean of the parts that have results
  (mobile has no D-pad). Coverage (captured screens out of 15 per theme) is shown beside, never mixed into a percentage.
