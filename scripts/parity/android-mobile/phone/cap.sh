#!/usr/bin/env bash
# Android phone parity capture (719x1558 at 295 dpi = 390x845 css at 1.8436), signed in as the static server's account, pinned clock.
# cap.sh <outdir> <Dark|Light> <screen...>
HERE=$(cd "$(dirname "$0")" && pwd)
export PATH=$HOME/Android/Sdk/platform-tools:$PATH ANDROID_SERIAL=${ANDROID_SERIAL:-emulator-5562}
# A hung emulator must not stall the run: every adb call is bounded (30 s, one retry) and then fails like any other failed command.
adb() { local rc n; for n in 1 2; do timeout 30 "$HOME/Android/Sdk/platform-tools/adb" "$@"; rc=$?; [ $rc -ne 124 ] && return $rc; done; return 124; }
O=$1; T=$2; shift 2; adb shell settings put global sysui_demo_allowed 1 >/dev/null 2>&1; adb shell am broadcast -a com.android.systemui.demo -e command enter >/dev/null 2>&1; adb shell am broadcast -a com.android.systemui.demo -e command clock -e hhmm 1200 >/dev/null 2>&1; pkg=io.playarr.mobile; mkdir -p "$O"
CLOCK=${PARITY_CLOCK:-$(sed -n 's/.*"clock": *"\([^"]*\)".*/\1/p' "$HERE/../../screens.json" | head -1)}
# Calendar posters are loopback art URLs on the static server (art port 18495): let the emulator reach the host's.
adb reverse tcp:18495 tcp:18495 >/dev/null 2>&1
adb shell am force-stop $pkg
adb shell cmd locale set-app-locales $pkg --locales en-GB >/dev/null 2>&1
adb shell "run-as $pkg sh -c 'mkdir -p shared_prefs; echo \"<?xml version=\\\"1.0\\\" encoding=\\\"utf-8\\\" standalone=\\\"yes\\\" ?><map><string name=\\\"theme\\\">$T</string></map>\" > shared_prefs/playarr_display.xml'"
open() { adb shell am force-stop $pkg; adb shell am start -n $pkg/.MainActivity --ez parity_no_insets true --es parity_route "$1" --es parity_clock $CLOCK --el parity_pause_at_ms 2000 >/dev/null; sleep "${2:-14}"; }
tapd() { python3 -I $HERE/uitap.py "$1" "${2:-tap}"; sleep "${3:-1.5}"; }
tapdesc() { local xy; xy=$(adb shell "rm -f /sdcard/ui.xml; uiautomator dump /sdcard/ui.xml >/dev/null; cat /sdcard/ui.xml" | python3 -I -c "
import re,sys
x=sys.stdin.read()
for m in re.finditer(r'content-desc=\"([^\"]*)\"[^>]*bounds=\"\[(\d+),(\d+)\]\[(\d+),(\d+)\]\"',x):
    if re.search(sys.argv[1],m.group(1)): print((int(m.group(2))+int(m.group(4)))//2,(int(m.group(3))+int(m.group(5)))//2); break
" "$1"); [ -n "$xy" ] && adb shell input tap $xy && sleep "${2:-1.5}"; }
shot() { sleep "${2:-5}"; adb shell dumpsys input_method | grep -q "mInputShown=true" && { adb shell input keyevent 4; sleep 1.5; }; for i in 1 2 3; do adb shell dumpsys activity activities | grep -m1 topResumed | grep -q $pkg || { echo "not foreground"; sleep 4; continue; }
  adb exec-out screencap -p > "$O/$1.png"; if [ "$(stat -c%s "$O/$1.png")" -gt 20000 ]; then
    if adb shell "rm -f /sdcard/ui.xml; uiautomator dump /sdcard/ui.xml >/dev/null; cat /sdcard/ui.xml" | grep -qiE "try again|reach the playarr|couldn.t|could not be loaded|sign in to playarr|isn.t responding|keeps stopping|has stopped|not responding"; then sleep 4; continue; fi
    rm -f "$O/layout/$1.json"; PARITY_PNG_OUT="$O/$1.png" python3 -I "$HERE/../layout.py" "$1" "$(echo "$T" | tr A-Z a-z)" phone "$O/layout/$1.json" >/dev/null 2>&1 || { echo "layout export failed $1"; rm -f "$O/layout/$1.json"; sleep 2; continue; }; echo "ok $1"; return 0; fi; sleep 2; done; rm -f "$O/$1.png"; echo "FAIL $1"; return 1; }
run() { case $1 in
  home) open home 16; shot $1 ;;
  movies) open movies 16; python3 -I $HERE/uiexpect.py 'Amber Thicket 3' || { echo "wrong screen movies"; return 1; }; shot $1 ;;
  series) open series 16; python3 -I $HERE/uiexpect.py '^Series$|Series' || { echo "wrong screen series"; return 1; }; shot $1 ;;
  music) open music 16; python3 -I $HERE/uiexpect.py 'Music' || { echo "wrong screen music"; return 1; }; shot $1 ;;
  search) open search 14; python3 -I $HERE/uiexpect.py 'Search your libraries' || { echo "wrong screen search"; return 1; }; shot $1 ;;
  settings) open settings 14; python3 -I $HERE/uiexpect.py 'Appearance' || { echo "wrong screen settings"; return 1; }; shot $1 ;;
  profiles) open home 14; tapdesc 'Open profiles' 3; python3 -I $HERE/uiexpect.py 'Who.s watching' || { echo "wrong screen profiles"; return 1; }; shot $1 ;;
  calendar-month) open "calendar?query=view%3Dmonth" 18; python3 -I $HERE/uiexpect.py 'Calendar' || return 1; shot $1 ;;
  calendar-week) open "calendar?query=view%3Dweek" 18; python3 -I $HERE/uiexpect.py 'Calendar' || return 1; shot $1 ;;
  calendar-agenda) open "calendar?query=view%3Dagenda" 18; python3 -I $HERE/uiexpect.py 'Calendar' || return 1; shot $1 ;;
  film-detail) open experience-detail/ca309574-c0f4-4564-bb54-4512eab7e531 18; python3 -I $HERE/uiexpect.py 'Chapters|Play' || { echo "detail still loading"; return 1; }; shot $1 4 ;;
  series-detail) open experience-detail/7ab4ce97-d59e-43d6-8e03-31d4d29a5c90 18; python3 -I $HERE/uiexpect.py 'Season|Episodes|Start|Resume' || { echo "detail still loading"; return 1; }; shot $1 4 ;;
  player-controls) open experience-detail/ca309574-c0f4-4564-bb54-4512eab7e531 18; python3 -I $HERE/uiexpect.py 'Chapters|Play' || { echo "detail still loading"; return 1; }; adb logcat -c; tapd 'Play' tap 3
    # The debug build pauses at 2.000 s and seeks exactly there; capture only once the player has reported that position twice (250 ms apart x4 per line), so every run shows the same frame.
    ok=0; for w in $(seq 1 60); do n=$(adb logcat -d -s PlayarrParity:I | grep -c 'player positionMs=2000$'); [ "$n" -ge 2 ] && { ok=1; break; }; sleep 1; done
    [ $ok = 1 ] || { echo "player did not settle at 2.000 s"; return 1; }
    # The grey buffered bar is clamped to 22.84 s in parity builds: wait until the player has buffered at least that, or its width depends on host load.
    ok=0; for w in $(seq 1 90); do b=$(adb logcat -d -s PlayarrParity:I | grep -o 'player bufferedMs=[0-9]*' | tail -1 | cut -d= -f2); [ "${b:-0}" -ge 22840 ] && { ok=1; break; }; sleep 1; done
    [ $ok = 1 ] || { echo "player did not buffer 22.84 s"; return 1; }
    # The chrome hides 5 s after playback starts; on a slow start it is gone by now. A tap on the surface brings it back without toggling playback.
    for w in 1 2 3; do python3 -I $HERE/uiexpect.py 'Mute|Seek|Quality' && break; adb shell input tap 360 500; sleep 3; done
    shot $1 3 || return 1
    python3 -I -c "import sys;from PIL import Image,ImageStat;im=Image.open(sys.argv[1]).convert('L').crop((0,560,719,1300));sys.exit(0 if ImageStat.Stat(im).mean[0]>60 else 1)" "$O/$1.png" || { echo 'player video not presented'; rm -f "$O/$1.png"; return 1; } ;;
  actions) open movies 16; python3 -I $HERE/uiexpect.py 'Amber Thicket 3' || { echo "wrong screen movies"; return 1; }; python3 -I $HERE/uitap.py 'Open 7 Distant Harbour 30' long || { echo 'actions card not found'; return 1; }; sleep 2; python3 -I $HERE/uiexpect.py 'Title actions|Mark as Watched' || { echo 'wrong screen actions'; return 1; }; shot $1 ;;
  calendar-link) NOKEY=1 open "calendar?query=panel%3Dsubscription" 18; python3 -I $HERE/uiexpect.py 'Calendar link' || { echo "wrong screen calendar-link"; return 1; }; sleep 3; shot $1 ;;
  filters) open movies 16; tapdesc '^Filters' 2; python3 -I $HERE/uiexpect.py 'Sort by|Library controls|Filters' || { echo "wrong screen filters"; return 1; }; shot $1 ;;
  *) echo "unknown $1" ;;
esac; }
for s in "$@"; do for attempt in 1 2; do run "$s" && break; done; done
