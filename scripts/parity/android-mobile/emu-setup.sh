#!/usr/bin/env bash
# One-off settings for a parity emulator: emu-setup.sh <serial> [<width>x<height> <density>]
# English (UK) locale, UTC, animations off, optional window size. Idempotent; run after every emulator boot.
set -euo pipefail
export PATH=$HOME/Android/Sdk/platform-tools:$PATH ANDROID_SERIAL=${1:?adb serial}
adb root >/dev/null 2>&1 || true; sleep 2
adb shell "setprop persist.sys.locale en-GB; setprop persist.sys.timezone UTC; cmd alarm set-timezone UTC" >/dev/null
for k in window_animation_scale transition_animation_scale animator_duration_scale; do adb shell settings put global "$k" 0; done
# The layout exporter reads the platform ellipsis string (hidden TextUtils.getEllipsisString) and fails without it: allow the
# debug build to call hidden APIs on this test emulator (the app stays unchanged; the string is still the platform's own).
adb shell settings put global hidden_api_policy 1
if [ -n "${2:-}" ]; then adb shell wm size "$2"; adb shell wm density "${3:?density}"; fi
# The static server's artwork listener is loopback-only: calendar posters carry loopback URLs, so forward the port.
eval "$(node "$(dirname "$0")/../parity-config.mjs" --shell)"
adb reverse "tcp:$PARITY_ART_PORT" "tcp:$PARITY_ART_PORT" >/dev/null
echo "emu-setup $ANDROID_SERIAL ok"
