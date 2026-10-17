# Local device and browser tests

CI runs only fast checks: lint, typecheck, format, unit tests and compile/build, scoped to what a change touches.
Everything below needs a browser, a simulator or a real device, so it is never run in CI. Run it by hand before a
change that touches the area. Use real devices where you have them.

## Web (from `clients/tv-web/web`)

Build once with `pnpm exec vite build` (run `pnpm --filter './packages/**' run build` from `clients/tv-web` first), and
install the capture tools with `npm ci && npx playwright-core install chromium` in `scripts/parity`.

| What | Command |
| --- | --- |
| All browser behaviour scripts | `node scripts/web-behaviour.mjs --dist dist` (add `--shard 1/4` to split, `--list` to list) |
| One behaviour script | `node scripts/web-behaviour.mjs --dist dist --only <name>` |
| Layout parity against the pinned reference | `node scripts/layout-parity.mjs --out <dir>` |
| Drawer, edge fade, search containment | `node scripts/drawer-close.mjs`; `node scripts/edge-fade-e2e.mjs`; `node scripts/search-contain-e2e.mjs` |
| Keyboard navigation | `node scripts/nav-<name>-e2e.mjs --no-build --dist dist` |
| Storybook render and accessibility smoke | `pnpm run build:storybook && node scripts/storybook-smoke.mjs` |

## Apple

| What | Command |
| --- | --- |
| iOS UI tests (simulator or device) | `xcodebuild test -scheme PlayarrApp -workspace clients/ios/Playarr.xcworkspace -only-testing:PlayarrAppUITests -destination '<destination>'` after `bash clients/ios/scripts/prepare.sh`; set `TEST_RUNNER_PLAYARR_UI_TEST_SERVER_URL`, `..._USERNAME`, `..._PASSWORD` |
| tvOS tests | `xcodebuild test -project clients/apple-tv/PlayarrTV.xcodeproj -scheme PlayarrTV -destination 'platform=tvOS Simulator,name=Apple TV'` |
| iOS captures | `scripts/parity/apple/capture-ios.sh` |
| tvOS captures | `scripts/parity/apple/capture-tvos.sh` |
| Apple TV AE0 parity | `scripts/appletv-parity-ae0.sh <web-ref-dir> <out-dir>` (needs `MAC_HOST`) |
| Release-build guard (no injected-session arguments) | build `PlayarrMac` and `PlayarrTV` in Release and check for `-PlayarrAccessToken` with `strings` (steps in `.github/workflows/apple-release-guard.yml`) |
| Simulator over VNC | `scripts/sim-vnc/sim_vnc.py` (see its README) |
| Hosted-runner device wall helpers | `scripts/apple-wall/wall.sh` (written for the removed wall workflow; needs its environment variables) |

## Android, Fire TV, Roku

| What | Command |
| --- | --- |
| Android TV captures | `scripts/parity/android-tv/capture.sh <out> <light\|dark>` |
| Android phone captures | `scripts/parity/android-mobile/capture.sh` |
| Android screenshot goldens | `./gradlew :core-designsystem:verifyRoborazziDebug` in `clients/android` |
| Fire TV captures | `scripts/parity/fire-tv/capture.sh` |
| Roku captures | `node scripts/parity/roku/capture.mjs` |

## Xbox and HarmonyOS

| What | Command |
| --- | --- |
| Xbox device helpers | `scripts/xbox-wall/` (`pair.py`, `install.ps1`, `pull-captures.sh`) against a dev-mode console |
| HarmonyOS Previewer | `scripts/harmony-wall/preview.sh build\|run <tv\|phone>` |

## Diff and fixtures

| What | Command |
| --- | --- |
| Fixture server | `scripts/fixtures/up.sh --fresh` (`down.sh` to stop) |
| Web reference captures | `node scripts/parity/capture-web.mjs` (see `docs/parity/README.md`) |
| Diff native against web | `node scripts/parity/diff.mjs --ref docs/parity/web --cand <dir> --layout tv --theme dark` |
