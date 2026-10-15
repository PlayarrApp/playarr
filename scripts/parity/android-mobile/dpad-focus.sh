#!/usr/bin/env bash
# Phone keyboard-focus driver. The phone UI ignores `adb shell input keyevent`; only `input dpad keyevent` reaches it.
# usage: dpad-focus.sh <serial> <route> <out-prefix> <keys...>   keys: R L U D (dpad), S (select), B (back),
#        tap:X,Y and hold:X,Y (touch). One screenshot is written per key as <out-prefix>-<n>-<key>.png, and the
#        focused node bounds are printed (uiautomator `focused="true"`), so a missing ring can be told from a missing focus.
set -euo pipefail
export PATH="$HOME/Android/Sdk/platform-tools:$PATH" ANDROID_SERIAL="$1"; route=$2; prefix=$3; shift 3
pkg=io.playarr.mobile
adb shell am force-stop "$pkg"
adb shell am start -n "$pkg/.MainActivity" --ez parity_no_insets true --es parity_route "$route" >/dev/null
sleep 30
n=0
for k in "$@"; do
  case $k in
    tap:*) xy=${k#tap:}; adb shell input tap "${xy%,*}" "${xy#*,}"; sleep 3; continue ;;
    hold:*) xy=${k#hold:}; adb shell input swipe "${xy%,*}" "${xy#*,}" "${xy%,*}" "${xy#*,}" 1300; sleep 3; continue ;;
    R) c=22 ;; L) c=21 ;; U) c=19 ;; D) c=20 ;; S) c=23 ;; B) c=4 ;;
    *) echo "unknown key $k" >&2; exit 2 ;;
  esac
  adb shell input dpad keyevent "$c"; sleep 1.3; n=$((n + 1))
  adb shell uiautomator dump /sdcard/u.xml >/dev/null
  echo "$n $k: $(adb shell cat /sdcard/u.xml | tr '<' '\n' | grep ' focused="true"' | grep -o 'bounds="[^"]*"' | tr '\n' ' ')"
  adb exec-out screencap -p > "$prefix-$n-$k.png"
done
