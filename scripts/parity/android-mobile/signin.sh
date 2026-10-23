#!/usr/bin/env bash
# Sign an Android parity emulator in to the static parity server: signin.sh <serial>
# Clears the app's data first. The password comes from ~/.secrets (PLAYARR_PARITY_STATIC_PASSWORD) and is never printed.
set -euo pipefail
export PATH=$HOME/Android/Sdk/platform-tools:$PATH ANDROID_SERIAL=${1:?adb serial}
eval "$(node "$(dirname "$0")/../parity-config.mjs" --shell)"
PW=$(grep -E '^(export )?PLAYARR_PARITY_STATIC_PASSWORD=' ~/.secrets | head -1 | sed -E 's/^(export )?[^=]*=//; s/^["'"'"']//; s/["'"'"']$//')
pkg=io.playarr.mobile
adb shell pm clear $pkg >/dev/null
adb shell am start -n $pkg/.MainActivity >/dev/null; sleep 10
fields() { adb shell "rm -f /sdcard/ui.xml; uiautomator dump /sdcard/ui.xml >/dev/null; cat /sdcard/ui.xml" | python3 -I -c "
import re,sys
for m in re.finditer(r'class=\"android.widget.EditText\"[^>]*?bounds=\"\[(\d+),(\d+)\]\[(\d+),(\d+)\]\"', sys.stdin.read()):
    a,b,c,d = map(int, m.groups()); print((a+c)//2, (b+d)//2)
"; }
n=0
for v in "$PARITY_SERVER_URL" "$PARITY_ACCOUNT_NAME" "$PW"; do
  xy=$(fields | sed -n "$((n + 1))p"); [ -n "$xy" ] || { echo "sign-in field $((n + 1)) not found" >&2; exit 1; }
  adb shell input tap $xy; sleep 1
  adb shell input keyevent KEYCODE_MOVE_END; adb shell input keyevent --longpress $(printf 'KEYCODE_DEL %.0s' $(seq 40)); sleep 0.5
  adb shell input text "$v"; sleep 1; adb shell input keyevent KEYCODE_BACK; sleep 1
  n=$((n + 1))
done
adb shell input keyevent KEYCODE_ENTER; sleep 15
adb shell "rm -f /sdcard/ui.xml; uiautomator dump /sdcard/ui.xml >/dev/null; cat /sdcard/ui.xml" | grep -qiE 'profile|home|movies' && echo "signed in (check the screen)" || { echo "sign-in not confirmed" >&2; exit 1; }
