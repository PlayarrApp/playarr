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
case $variant in native) act=io.playarr.mobile.MainActivity ;; web) act=io.playarr.mobile.webshell.WebTvShellActivity ;; *) echo "variant: native|web" >&2; exit 2 ;; esac
here=$(cd "$(dirname "$0")" && pwd)
eval "$(node "$here/../parity-config.mjs" --shell)"
server=$PARITY_SERVER_URL; user=${PARITY_ACCOUNT_NAME:-parity}
password=$(P="$here/../dpad-account.mjs" node -e 'import(process.env.P).then((m) => process.stdout.write(m.readSecrets().PLAYARR_PARITY_STATIC_PASSWORD ?? ""))')
pkg=${PERF_PKG:-app.playarr.mobile}
mkdir -p "$out"; jsonl="$out/$variant.jsonl"; : > "$jsonl"

key() { adb shell input keyevent "KEYCODE_$1"; }
tap() { adb shell input tap "$1" "$2"; }
now_ms() { adb shell 'date +%s%3N' | tr -d '\r'; }
wait_marker() { # <marker> <timeout s>: prints the device epoch ms of the marker line, or nothing
  local t
  for _ in $(seq 1 $(($2 * 5))); do
    t=$(adb logcat -d -v epoch -s PlayarrPerf:I | awk -v m="$1" '$NF == m { printf "%d", $1 * 1000 }' | head -1)
    [ -n "$t" ] && { echo "$t"; return; }
    sleep 0.2
  done
}

adb shell cmd uimode night yes >/dev/null 2>&1 || true  # dark for both variants (the app theme follows the system; works on non-debuggable builds)
adb shell cmd alarm set-timezone UTC >/dev/null 2>&1 || true
adb shell settings put global window_animation_scale 1; adb shell settings put global transition_animation_scale 1; adb shell settings put global animator_duration_scale 1

# Play applies the shipped baseline profile at install; `adb install` does not (run-from-apk, interpreted). Compile both arms
# the same way so the numbers mirror a Play install. PERF_COMPILE=none skips it (label then reads "uncompiled").
compile_mode=${PERF_COMPILE:-speed-profile}
if [ "$compile_mode" != none ]; then
  adb shell cmd package compile -m "$compile_mode" -f $pkg >/dev/null 2>&1 || { echo "compile -m $compile_mode failed" >&2; exit 6; }
  [ $variant = web ] && adb shell cmd package compile -m "$compile_mode" -f com.google.android.webview >/dev/null 2>&1 || true
  compiled=$compile_mode
else compiled=uncompiled; fi
echo "compile: $compiled" >&2

setup_native() { # the first launch after a fresh boot can still be on the splash at the first tap: verify the sign-in and retry
  for attempt in 1 2 3; do
    sign_in_native
    adb logcat -c; adb shell am start -n $pkg/io.playarr.mobile.MainActivity >/dev/null
    [ -n "$(wait_marker home_ready 30)" ] && { adb shell am force-stop $pkg; return; }
    echo "sign-in attempt $attempt did not reach Home, retrying" >&2
  done
  echo "native sign-in failed" >&2; exit 7
}
sign_in_native() {
  adb shell pm clear $pkg >/dev/null
  adb shell cmd locale set-app-locales $pkg --locales en-GB >/dev/null 2>&1 || true
  adb shell am start -n $pkg/io.playarr.mobile.MainActivity >/dev/null; sleep 10
  tap 960 898; sleep 2; tap 960 445; sleep 1
  key MOVE_END; adb shell 'for i in $(seq 1 60); do input keyevent KEYCODE_DEL; done'
  adb shell input text "$server"; key TAB
  adb shell 'for i in $(seq 1 40); do input keyevent KEYCODE_DEL; done'; adb shell input text "$user"; key TAB
  adb shell 'for i in $(seq 1 40); do input keyevent KEYCODE_DEL; done'; adb shell input text "$password"; key ENTER; sleep 1
  tap 960 771; sleep 10
  adb shell am force-stop $pkg
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
  # Health gate: the emulator must answer quickly and be booted, else the run is invalid (a throttled emulator made runs 3-6 null).
  s0=$(date +%s); adb shell getprop sys.boot_completed >/dev/null; [ $(( $(date +%s) - s0 )) -le 5 ] || { echo "emulator unresponsive before iteration $n" >&2; exit 3; }
  adb shell am force-stop $pkg; adb shell am force-stop com.google.android.webview; sleep 2  # webview_service is counted in PSS: start each arm without a lingering one
  t0=$(now_ms)
  start=$(start_app)
  total=$(printf '%s\n' "$start" | awk '/TotalTime/ { print $2 }')
  ready=$(wait_marker home_ready 60)
  [ -n "$ready" ] || { echo "iteration $n: no home_ready, aborting (top: $(adb shell dumpsys window | grep -m1 mCurrentFocus))" >&2; exit 4; }
  adb shell dumpsys activity activities | grep -q 'ResumedActivity.*app.playarr.mobile' || { echo "iteration $n: activity not resumed" >&2; exit 5; }
  sleep 3
  # Native lands on the nav rail; web on the first card. Normalise: BACK-free, go Right until a card is focused (one press from the rail).
  frames="$out/$variant-$n.frames"; : > "$frames"
  adb shell dumpsys gfxinfo $pkg reset >/dev/null
  press() { # one D-pad press, then drain the frame buffer
    key "$1"; sleep 0.45
    adb shell dumpsys gfxinfo $pkg framestats | awk '/---PROFILEDATA---/ { on = !on; next } on && $1 ~ /^[0-9]+,/ && $1 !~ /^Flags/' | tee -a "$frames" > "$frames.press"
    # PERF_PRESS_LOG=<file>: one line per press with the slowest frame (diagnostic, to find which action spikes)
    [ -n "${PERF_PRESS_LOG:-}" ] && awk -F, -v k="$1" -v n="$n" '$1 == 0 && $18 > 0 { t = ($18 - $3) / 1e6; if (t > m) m = t; c++ } END { printf "iter %s %s max_ms %.0f frames %d\n", n, k, m, c }' "$frames.press" >> "$PERF_PRESS_LOG"
    adb shell dumpsys gfxinfo $pkg reset >/dev/null
  }
  seq_keys=(DPAD_RIGHT DPAD_RIGHT DPAD_RIGHT DPAD_RIGHT DPAD_RIGHT DPAD_RIGHT DPAD_RIGHT DPAD_RIGHT DPAD_RIGHT DPAD_RIGHT
            DPAD_DOWN DPAD_RIGHT DPAD_RIGHT DPAD_RIGHT DPAD_RIGHT DPAD_RIGHT DPAD_DOWN DPAD_LEFT DPAD_LEFT DPAD_LEFT
            DPAD_LEFT DPAD_LEFT DPAD_UP DPAD_RIGHT DPAD_RIGHT DPAD_RIGHT DPAD_DOWN DPAD_DOWN DPAD_LEFT DPAD_LEFT DPAD_UP DPAD_UP)
  press DPAD_CENTER; sleep 2.5                         # open the first card's title (the movie Home opens on; other cards crash the native build, see STATUS)'s detail page
  for k in DPAD_DOWN DPAD_DOWN DPAD_RIGHT DPAD_RIGHT DPAD_LEFT DPAD_DOWN DPAD_UP DPAD_UP DPAD_RIGHT DPAD_LEFT DPAD_DOWN DPAD_UP DPAD_UP DPAD_LEFT DPAD_DOWN DPAD_UP; do press "$k"; done  # 16 presses on the detail page
  press BACK 2>/dev/null || true; sleep 1.5  # back to Home
  for k in "${seq_keys[@]}"; do press "$k"; done      # 32 presses over Home rails
  # 1 + 16 + 1 + 32 = 50 presses (Select on play follows after a fresh launch).
  [ -n "${PERF_SHOT:-}" ] && adb exec-out screencap -p > "$PERF_SHOT-$variant-$n.png"
  # PERF_MEM_DUMP=<prefix>: keep the full per-process meminfo (native heap, graphics, code) of the app and the WebView processes.
  if [ -n "${PERF_MEM_DUMP:-}" ]; then
    for p in $pkg com.google.android.webview:webview_service; do adb shell dumpsys meminfo "$p" > "$PERF_MEM_DUMP-$variant-$n-${p##*:}.txt" 2>&1 || true; done
    adb shell dumpsys meminfo | awk '/^Total PSS by process:/ { on = 1; next } on && /^$/ { exit } on' > "$PERF_MEM_DUMP-$variant-$n-all.txt"
  fi
  mem=$(adb shell dumpsys meminfo | awk '/^Total PSS by process:/ { on = 1; next } on && /^$/ { exit } on && ($0 ~ /app\.playarr\.mobile/ || $0 ~ /webview_service/ || $0 ~ /sandboxed_process/) { v = $1; gsub(/[,K]/, "", v); s += v } END { print s + 0 }')
  # Select to first frame on a fresh launch: Home opens on the first card (a movie), Select opens its detail page where the
  # play button is the default focus, Select again starts playback.
  adb shell am force-stop $pkg; sleep 2
  start_app >/dev/null; wait_marker home_ready 60 >/dev/null; sleep 3
  key DPAD_CENTER; sleep 3
  adb logcat -c
  tsel=$(now_ms); key DPAD_CENTER
  first=$(wait_marker first_frame 40)
  adb shell am force-stop $pkg
  printf '{"compiled":"%s","variant":"%s","n":%s,"start_total_ms":%s,"ready_ms":%s,"pss_kb":%s,"select_to_first_frame_ms":%s,"frames":"%s"}\n' \
    "$compiled" "$variant" "$n" "${total:-null}" "$([ -n "$ready" ] && echo $((ready - t0)) || echo null)" "${mem:-null}" \
    "$([ -n "$first" ] && echo $((first - tsel)) || echo null)" "$(basename "$frames")" | tee -a "$jsonl"
done
