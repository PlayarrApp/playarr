#!/usr/bin/env bash
# One command for the whole Fire TV (Vega OS) parity run on the Vega virtual device, against the static parity server:
#   scripts/parity/vega/run.sh <out-dir>            # screens in both themes, then the D-pad checks
#   scripts/parity/vega/run.sh <out-dir> screens    # screens only
#   scripts/parity/vega/run.sh <out-dir> dpad       # D-pad only
# Writes <out-dir>/{dark,light}/<screen>.png, <out-dir>/readiness.json, <out-dir>/dpad.json and <out-dir>/build.json.
#
# Before it: the virtual device is running headless (an Xvfb display, no VNC) at 1920x1080 with the emulator window at the top left,
# the app built with PLAYARR_PARITY_CONTROL=1 is installed and the device is signed in to the static server's parity account.
# Environment (drivers/firetv.mjs explains each): PLAYARR_FIRETV_VEGA, PLAYARR_FIRETV_DISPLAY, PLAYARR_FIRETV_XDOTOOL,
# PLAYARR_FIRETV_LIBS, ANDROID_ADB_SERVER_PORT. The account password is read from the parity secrets file, never printed.
# The app clock is pinned to the fixture instant (2026-10-07T12:00:00Z) by the driver, the canonical On deck is seeded by the suite.
#
# Screens are reached by route (--via route): the key paths of suite.json need a dropped-key-free emulator, and the driver replays
# the keys that matter (Filters tile, title actions drawer) after the route. The D-pad checks reach their start screen by route too and then press the real keys under test.
set -euo pipefail
out=${1:?usage: run.sh <out-dir> [screens|dpad]}
only=${2:-all}
here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$here"
eval "$(node parity-config.mjs --shell)"
export PARITY_CLIENT=${PARITY_CLIENT:-firetv} PARITY_LOCK_DIR=${PARITY_LOCK_DIR:-${TMPDIR:-/tmp}/parity-firetv-lock}
mkdir -p "$out" "$PARITY_LOCK_DIR"
# player-controls plays the pinned film with the app pausing itself at 2 s (cmd=armPause).
screens=home,movies,series,music,calendar-month,calendar-week,calendar-agenda,search,film-detail,series-detail,settings,filters,profiles,player-controls,actions,calendar-link
suite() { node suite-run.mjs --driver ./drivers/firetv.mjs --skip-player --out "$out" "$@"; }
if [ "$only" = all ] || [ "$only" = screens ]; then suite --via route --only screens --screens "$screens" --extra-screens calendar-link; fi
if [ "$only" = all ] || [ "$only" = dpad ]; then suite --via route --only dpad; fi
repo="$(git rev-parse --show-toplevel)"
printf '{"branch":"%s","sha":"%s","pr":%s,"captured_at":"%s","server":"static server"}\n' \
  "$(git -C "$repo" branch --show-current)" "$(git -C "$repo" rev-parse --short HEAD)" "${PARITY_PR:-null}" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$out/build.json"
