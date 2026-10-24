#!/usr/bin/env bash
# One command for the full Android TV parity run (also covers Fire OS, which runs the same app) against the static parity server:
# 15 screens in dark and light plus the D-pad checks, with the pinned clock, written into the legend dir.
#   scripts/parity/android-tv/run.sh [out-dir]       (default out-dir: $PARITY_LEGEND_DIR/android/dev)
# Needs: an emulator headless at 1920x1080 (user unit playarr-android-tv-vnc.service, `-no-window`), the sideload debug APK installed
# (`./gradlew :app:assembleSideloadDebug`), the app signed in to the static server (`android-tv/sign-in.sh`), the static server up.
# Extra suite-run arguments after the out-dir are passed on, e.g. `--only screens --themes dark`.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
out=${1:-${PARITY_LEGEND_DIR:?set PARITY_LEGEND_DIR or pass an out-dir}/android/dev}; [ $# -gt 0 ] && shift
export PATH=$HOME/Android/Sdk/platform-tools:$PATH ANDROID_SERIAL=${ANDROID_SERIAL:-emulator-5560}
[ -x "${ANDROID_HOME:-/nonexistent}/platform-tools/adb" ] || unset ANDROID_HOME  # the driver then uses adb from PATH
eval "$(node "$here/../parity-config.mjs" --shell)"
export PARITY_CLIENT=${PARITY_CLIENT:-android-tv} PARITY_LOCK_DIR=${PARITY_LOCK_DIR:-$out/../.lock}
# The static server's artwork URLs (calendar posters, key art) name its loopback artwork port: the emulator reaches them through a reverse tunnel.
adb reverse "tcp:$PARITY_ART_PORT" "tcp:$PARITY_ART_PORT" >/dev/null
cd "$here/.."
node suite-run.mjs --driver ./drivers/android-tv.mjs --out "$out" --expected "$here/../expected.static.json" "$@"
