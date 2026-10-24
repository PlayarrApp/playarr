#!/usr/bin/env bash
# Sign the Android TV app in to the static parity server as the `parity` account (QR sign-in screen, then "Sign in manually").
#   ANDROID_SERIAL=emulator-5560 scripts/parity/android-tv/sign-in.sh
# Clears the app data first, sets en-GB and UTC (the web refs are captured in both), and leaves the app signed in on Home.
# The password comes from ~/.secrets (PLAYARR_PARITY_STATIC_PASSWORD) and is never printed.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
eval "$(node "$here/../parity-config.mjs" --shell)"
# Reachable from the emulator's NAT: the LAN address of the host works as on a real TV.
server=$PARITY_SERVER_URL; user=$PARITY_ACCOUNT_NAME
password=$(node -e 'import(process.argv[1]).then((m) => process.stdout.write(m.readSecrets().PLAYARR_PARITY_STATIC_PASSWORD ?? ""))' "$here/../dpad-account.mjs")
[ -n "$password" ] || { echo "PLAYARR_PARITY_STATIC_PASSWORD missing" >&2; exit 2; }
pkg=${PARITY_PACKAGE:-io.playarr.mobile}
tap() { adb shell input tap "$1" "$2"; }
key() { adb shell input keyevent "KEYCODE_$1"; }
adb shell pm clear "$pkg" >/dev/null
adb shell cmd alarm set-timezone UTC >/dev/null 2>&1 || true
adb shell cmd locale set-app-locales "$pkg" --locales en-GB >/dev/null 2>&1 || true
adb shell am start -n "$pkg/.MainActivity" >/dev/null; sleep 8
tap 960 898; sleep 2
tap 960 445; sleep 1
key MOVE_END; adb shell 'for i in $(seq 1 60); do input keyevent KEYCODE_DEL; done'
adb shell input text "$server"; key TAB
adb shell 'for i in $(seq 1 40); do input keyevent KEYCODE_DEL; done'; adb shell input text "$user"; key TAB
adb shell 'for i in $(seq 1 40); do input keyevent KEYCODE_DEL; done'; adb shell input text "$password"; key ENTER; sleep 1
tap 960 771; sleep 8
adb shell am force-stop "$pkg"
