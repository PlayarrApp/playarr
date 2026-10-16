#!/usr/bin/env bash
# One-shot tablet capture: cap-guarded.sh <outdir> <Light|Dark> <series-detail|calendar-week>.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
ADB=${PLAYARR_TABLET_ADB:-${ANDROID_HOME:-$HOME/Android/Sdk}/platform-tools/adb}
export ANDROID_SERIAL=emulator-5568 PLAYARR_TABLET_ADB="$ADB"
pkg=io.playarr.mobile
O=${1:?output directory required}; T=${2:?theme required}; screen=${3:?screen required}
[[ $# -eq 3 ]] || { echo "exactly three arguments are required" >&2; exit 2; }
[[ "$ANDROID_SERIAL" == emulator-5568 ]] || { echo "unexpected Android target" >&2; exit 2; }
[[ "$T" == Light || "$T" == Dark ]] || { echo "theme must be Light or Dark" >&2; exit 2; }
[[ "$screen" == series-detail || "$screen" == calendar-week ]] || { echo "unsupported screen" >&2; exit 2; }
scratch_root=${PLAYARR_SCRATCH_ROOT:?authorised scratch root is required}
scratch_root=$(realpath -e "$scratch_root")
output_path=$(realpath -m "$O")
case "$output_path" in "$scratch_root"/*) ;; *) echo "output must be below the authorised scratch directory" >&2; exit 2;; esac
[[ -n "${PARITY_ANDROID_FIXTURE_CLOCK:-}" ]] || { echo "shared parity fixture clock is required" >&2; exit 2; }
[[ "$PARITY_ANDROID_FIXTURE_CLOCK" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] || { echo "fixture clock must be a UTC instant with whole seconds" >&2; exit 2; }
python3 -I -c 'import datetime,sys; datetime.datetime.strptime(sys.argv[1], "%Y-%m-%dT%H:%M:%SZ")' "$PARITY_ANDROID_FIXTURE_CLOCK" || { echo "fixture clock is invalid" >&2; exit 2; }
case "$screen" in
  series-detail)
    [[ -n "${PARITY_SERIES_WORK_ID:-}" && "$PARITY_SERIES_WORK_ID" =~ ^[A-Za-z0-9_-]+$ ]] || { echo "runtime series fixture id is required" >&2; exit 2; }
    route="experience-detail/$PARITY_SERIES_WORK_ID"
    expected_route='route=experience-detail/{workId}?mediaFileId={mediaFileId}'
    ui_patterns=("[Ss]eason" "[Ee]pisodes")
    ;;
  calendar-week)
    [[ "${PARITY_CALENDAR_DATE:-}" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || { echo "runtime calendar date is required" >&2; exit 2; }
    route="calendar?query=view%3Dweek%26date%3D${PARITY_CALENDAR_DATE}"
    expected_route='route=calendar?query={query}'
    ui_patterns=("Calendar" "Today")
    ;;
esac
mkdir -p "$output_path"
node "$HERE/session-guard.mjs" "$ANDROID_SERIAL"
"$ADB" -s "$ANDROID_SERIAL" get-state >/dev/null
size_output=$("$ADB" -s "$ANDROID_SERIAL" shell wm size | tr -d '\r')
effective_size=$(printf '%s\n' "$size_output" | sed '/^[[:space:]]*$/d' | tail -n 1)
[[ "$effective_size" == "Physical size: 2560x1600" || "$effective_size" == "Override size: 2560x1600" ]] || { echo "tablet window size check failed" >&2; exit 2; }
"$ADB" -s "$ANDROID_SERIAL" shell am force-stop "$pkg"
"$ADB" -s "$ANDROID_SERIAL" logcat -c
"$ADB" -s "$ANDROID_SERIAL" shell cmd locale set-app-locales "$pkg" --locales en-GB >/dev/null 2>&1
"$ADB" -s "$ANDROID_SERIAL" shell "run-as $pkg sh -c 'mkdir -p shared_prefs; echo \"<?xml version=\\\"1.0\\\" encoding=\\\"utf-8\\\" standalone=\\\"yes\\\" ?><map><string name=\\\"theme\\\">$T</string></map>\" > shared_prefs/playarr_display.xml'"
theme_xml=$("$ADB" -s "$ANDROID_SERIAL" exec-out run-as "$pkg" cat shared_prefs/playarr_display.xml)
python3 -c 'import sys,xml.etree.ElementTree as E; r=E.fromstring(sys.stdin.read()); n=r.find("string[@name=\"theme\"]"); assert n is not None and n.text==sys.argv[1]' "$T" <<<"$theme_xml"
"$ADB" -s "$ANDROID_SERIAL" shell am start -n "$pkg/.MainActivity" --ez parity_no_insets true --es parity_route "$route" --es parity_clock "$PARITY_ANDROID_FIXTURE_CLOCK" >/dev/null
sleep 24
activity_output=$("$ADB" -s "$ANDROID_SERIAL" shell dumpsys activity activities | tr -d '\r')
top_resumed=$(printf '%s\n' "$activity_output" | awk '/topResumedActivity/ { print; found=1 } END { if (!found) exit 1 }') || { echo "top resumed activity is unavailable" >&2; exit 1; }
[[ "$top_resumed" == *"$pkg"* ]] || { echo "app did not become foreground" >&2; exit 1; }
route_output=$("$ADB" -s "$ANDROID_SERIAL" logcat -d -s PlayarrParity:I | tr -d '\r')
[[ "$route_output" == *"$expected_route"* ]] || { echo "fresh route verification failed" >&2; exit 1; }
[[ "$route_output" == *"clock_consumed=$PARITY_ANDROID_FIXTURE_CLOCK"* ]] || { echo "fixture clock was not consumed" >&2; exit 1; }
if [[ "$screen" == calendar-week && "$route_output" != *"calendar view=week"* ]]; then
  echo "calendar did not resolve to week view" >&2; exit 1
fi
set +e
python3 -I "$HERE/uiexpect-once.py" --adb "$ADB" --serial "$ANDROID_SERIAL" "${ui_patterns[@]}"
ui_status=$?
set -e
[[ $ui_status -eq 0 ]] || { echo "fresh visible screen structure check failed" >&2; exit 1; }
error_patterns=('try again|reach the playarr|could not be loaded|sign in to playarr|isn.t responding|keeps stopping|has stopped|close app|not responding')
set +e
python3 -I "$HERE/uiexpect-once.py" --adb "$ADB" --serial "$ANDROID_SERIAL" "${error_patterns[@]}"
error_status=$?
set -e
[[ $error_status -eq 1 ]] || { echo "fresh error-state hierarchy check failed" >&2; exit 1; }
activity_output=$("$ADB" -s "$ANDROID_SERIAL" shell dumpsys activity activities | tr -d '\r')
top_resumed=$(printf '%s\n' "$activity_output" | awk '/topResumedActivity/ { print; found=1 } END { if (!found) exit 1 }') || { echo "top resumed activity is unavailable" >&2; exit 1; }
[[ "$top_resumed" == *"$pkg"* ]] || { echo "app left foreground before capture" >&2; exit 1; }
node "$HERE/session-guard.mjs" "$ANDROID_SERIAL"
capture_path="$output_path/.capture.unverified.$$.png"
"$ADB" -s "$ANDROID_SERIAL" exec-out screencap -p >"$capture_path"
python3 -I -c 'import struct,sys; d=open(sys.argv[1],"rb").read(); assert d[:8]==b"\x89PNG\r\n\x1a\n" and d[-8:-4]==b"IEND" and struct.unpack(">II",d[16:24])==(2560,1600)' "$capture_path"
mv -- "$capture_path" "$output_path/$screen-$T.png"
echo "captured $screen $T"
