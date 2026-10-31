#!/usr/bin/env bash
# Android TV performance A/B: the native Compose UI against the web view shell, same APK, same emulator, same server.
#   perf-ab.sh <native|web> <iterations> <out-dir>
# Per iteration (one JSON line each in <out-dir>/<variant>.jsonl, raw framestats in <out-dir>/<variant>-<n>.frames):
#   1. cold start: force-stop, `am start -W` (TotalTime) and the ready marker (`PlayarrPerf home_ready` in logcat, logged once
#      the first Home card is laid out and painted) measured from the device clock before the start;
#   2. D-pad navigation, 50 scripted presses over Home rails and a detail page; `dumpsys gfxinfo <pkg> framestats` is read and
#      reset after every press (the buffer holds only 120 frames), frame time = FrameCompleted - IntendedVsync;
#   3. `dumpsys meminfo`: summed PSS of the app and WebView processes after the navigation;
#   4. Select on the detail page's play button to the player's first frame (`PlayarrPerf first_frame`).
# Needs: adb (ANDROID_SERIAL), the sideload APK installed (a build with -PplayarrTvWebAssets for the web variant), the static
# parity server (scripts/parity/static-server.sh). The app is signed in once (native: through the sign-in screen; web: a session
# seeded into the WebView storage before the page boots) and its data is kept between iterations.
set -euo pipefail
variant=$1; iters=$2; out=$3
case $variant in native) act=.MainActivity ;; web) act=.webshell.WebTvShellActivity ;; *) echo "variant: native|web" >&2; exit 2 ;; esac
here=$(cd "$(dirname "$0")" && pwd)
eval "$(node "$here/../parity-config.mjs" --shell)"
server=$PARITY_SERVER_URL; user=${PARITY_ACCOUNT_NAME:-parity}
password=$(node -e 'import(process.argv[1]).then((m) => process.stdout.write(m.readSecrets().PLAYARR_PARITY_STATIC_PASSWORD ?? ""))' "$here/../dpad-account.mjs")
pkg=io.playarr.mobile
mkdir -p "$out"; jsonl="$out/$variant.jsonl"; : > "$jsonl"

key() { adb shell input keyevent "KEYCODE_$1"; }
tap() { adb shell input tap "$1" "$2"; }
now_ms() { adb shell 'date +%s%3N' | tr -d '\r'; }
wait_marker() { # <marker> <timeout s>: prints the device epoch ms of the marker line, or nothing
  local t
  for _ in $(seq 1 $(($2 * 5))); do
    t=$(adb logcat -d -v epoch -s PlayarrPerf:I | awk -v m="$1" '$NF == m { printf "%d", $2 * 1000 }' | tail -1)
    [ -n "$t" ] && { echo "$t"; return; }
    sleep 0.2
  done
}

adb shell cmd alarm set-timezone UTC >/dev/null 2>&1 || true
adb shell settings put global window_animation_scale 1; adb shell settings put global transition_animation_scale 1; adb shell settings put global animator_duration_scale 1

setup_native() {
  adb shell pm clear $pkg >/dev/null
  adb shell cmd locale set-app-locales $pkg --locales en-GB >/dev/null 2>&1 || true
  adb shell am start -n $pkg/.MainActivity >/dev/null; sleep 10
  tap 960 898; sleep 2; tap 960 445; sleep 1
  key MOVE_END; adb shell 'for i in $(seq 1 60); do input keyevent KEYCODE_DEL; done'
  adb shell input text "$server"; key TAB
  adb shell 'for i in $(seq 1 40); do input keyevent KEYCODE_DEL; done'; adb shell input text "$user"; key TAB
  adb shell 'for i in $(seq 1 40); do input keyevent KEYCODE_DEL; done'; adb shell input text "$password"; key ENTER; sleep 1
  tap 960 771; sleep 10
  adb shell am force-stop $pkg
  # The app's own theme (debug builds only: run-as), as capture.sh sets it, matching the seeded web theme.
  adb shell "run-as $pkg sh -c 'mkdir -p shared_prefs; echo \"<?xml version=\\\"1.0\\\" encoding=\\\"utf-8\\\" standalone=\\\"yes\\\" ?><map><string name=\\\"theme\\\">Dark</string></map>\" > shared_prefs/playarr_display.xml'" || true
}
seed_b64() { # a fresh login per launch (access tokens last 15 minutes), as capture-web.mjs seeds it
  PERF_SERVER=$server PERF_USER=$user PERF_PASSWORD=$password node "$here/perf-seed.mjs"
}
setup_web() { adb shell pm clear $pkg >/dev/null; }

start_app() {
  adb logcat -c
  if [ $variant = web ]; then
    adb shell am start -W -n $pkg/$act --es parity_seed_b64 "$(seed_b64)" 2>&1 | tr -d '\r'
  else
    adb shell am start -W -n $pkg/$act 2>&1 | tr -d '\r'
  fi
}

[ $variant = native ] && setup_native || setup_web

for n in $(seq 1 "$iters"); do
  adb shell am force-stop $pkg; sleep 2
  t0=$(now_ms)
  start=$(start_app)
  total=$(printf '%s\n' "$start" | awk '/TotalTime/ { print $2 }')
  ready=$(wait_marker home_ready 60)
  sleep 3
  # Native lands on the nav rail; web on the first card. Normalise: BACK-free, go Right until a card is focused (one press from the rail).
  frames="$out/$variant-$n.frames"; : > "$frames"
  adb shell dumpsys gfxinfo $pkg reset >/dev/null
  press() { # one D-pad press, then drain the frame buffer
    key "$1"; sleep 0.45
    adb shell dumpsys gfxinfo $pkg framestats | awk '/---PROFILEDATA---/ { on = !on; next } on && $1 ~ /^[0-9]+,/ && $1 !~ /^Flags/' >> "$frames"
    adb shell dumpsys gfxinfo $pkg reset >/dev/null
  }
  seq_keys=(DPAD_RIGHT DPAD_RIGHT DPAD_RIGHT DPAD_RIGHT DPAD_RIGHT DPAD_RIGHT DPAD_RIGHT DPAD_RIGHT DPAD_RIGHT DPAD_RIGHT
            DPAD_DOWN DPAD_RIGHT DPAD_RIGHT DPAD_RIGHT DPAD_RIGHT DPAD_RIGHT DPAD_DOWN DPAD_LEFT DPAD_LEFT DPAD_LEFT
            DPAD_LEFT DPAD_LEFT DPAD_UP DPAD_RIGHT DPAD_RIGHT DPAD_RIGHT DPAD_DOWN DPAD_DOWN DPAD_LEFT DPAD_LEFT DPAD_UP DPAD_UP)
  for k in "${seq_keys[@]}"; do press "$k"; done      # 32 presses over Home rails
  press DPAD_CENTER; sleep 2.5                         # open the focused title's detail page
  for k in DPAD_DOWN DPAD_DOWN DPAD_RIGHT DPAD_RIGHT DPAD_LEFT DPAD_DOWN DPAD_UP DPAD_UP DPAD_RIGHT DPAD_LEFT DPAD_DOWN DPAD_UP DPAD_UP DPAD_LEFT DPAD_DOWN DPAD_UP; do press "$k"; done  # 16 presses
  # 33 + 16 = 49 presses plus the next one below (Select on play) = 50.
  mem=$(adb shell dumpsys meminfo | awk '/^Total PSS by process:/ { on = 1; next } on && /^$/ { exit } on && ($0 ~ /io\.playarr\.mobile/ || $0 ~ /webview/ || $0 ~ /chromium/ || $0 ~ /sandboxed_process/) { v = $1; gsub(/[,K]/, "", v); s += v } END { print s + 0 }')
  # Back to the top of the detail page where the play button is the default focus, then Select.
  adb logcat -c
  tsel=$(now_ms); key DPAD_CENTER
  first=$(wait_marker first_frame 40)
  adb shell am force-stop $pkg
  printf '{"variant":"%s","n":%s,"start_total_ms":%s,"ready_ms":%s,"pss_kb":%s,"select_to_first_frame_ms":%s,"frames":"%s"}\n' \
    "$variant" "$n" "${total:-null}" "$([ -n "$ready" ] && echo $((ready - t0)) || echo null)" "${mem:-null}" \
    "$([ -n "$first" ] && echo $((first - tsel)) || echo null)" "$(basename "$frames")" | tee -a "$jsonl"
done
