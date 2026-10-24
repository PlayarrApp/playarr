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
# The sign-in button is the only "Sign in" text node; tap it (Enter does not submit).
xy=$(adb shell "rm -f /sdcard/ui.xml; uiautomator dump /sdcard/ui.xml >/dev/null; cat /sdcard/ui.xml" | python3 -I -c "
import re,sys
for m in re.finditer(r'text=\"Sign in\"[^>]*?clickable=\"true\"[^>]*?bounds=\"\[(\d+),(\d+)\]\[(\d+),(\d+)\]\"|clickable=\"true\"[^>]*?bounds=\"\[(\d+),(\d+)\]\[(\d+),(\d+)\]\"[^>]*>\s*<node[^>]*text=\"Sign in\"', sys.stdin.read()):
    g=[int(x) for x in m.groups() if x]; print((g[0]+g[2])//2,(g[1]+g[3])//2); break
")
[ -n "$xy" ] || xy="$(adb shell wm size | grep -oE '[0-9]+x[0-9]+' | tail -1 | awk -Fx '{print int($1/2), int($2*0.857)}')"
adb shell input tap $xy; sleep 20
adb shell "rm -f /sdcard/ui.xml; uiautomator dump /sdcard/ui.xml >/dev/null; cat /sdcard/ui.xml" | grep -q 'Sign in to Playarr' && { echo "sign-in not completed" >&2; exit 1; }
echo "signed in"
