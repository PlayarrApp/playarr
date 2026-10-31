#!/usr/bin/env bash
HERE=$(cd "$(dirname "$0")" && pwd)
# Tablet capture driver (emulator-5568, 2560x1600, sideload debug build): cap.sh <outdir> <Dark|Light> <screen...>. Home-focus screens (home-last, movies-last, nav-focus ...) drive focus with keys. Reset the Device Test account progress (reset-deck-canonical.mjs) before capturing home.
S_STATE=/dev/null
# The web refs freeze the clock at the fixture instant; the app clock must match (debug launch extra parity_clock).
CLOCK=${PARITY_CLOCK:-$(sed -n 's/.*"clock": *"\([^"]*\)".*/\1/p' "$HERE/../../screens.json" | head -1)}
export PATH=$HOME/Android/Sdk/platform-tools:$PATH ANDROID_SERIAL=${ANDROID_SERIAL:-emulator-5568}
# A hung emulator must not stall the run: every adb call is bounded (30 s, one retry) and then fails like any other failed command.
adb() { local rc n; for n in 1 2; do timeout 30 "$HOME/Android/Sdk/platform-tools/adb" "$@"; rc=$?; [ $rc -ne 124 ] && return $rc; done; return 124; }
O=$1; T=$2; shift 2; adb shell settings put global sysui_demo_allowed 1 >/dev/null 2>&1; adb shell am broadcast -a com.android.systemui.demo -e command enter >/dev/null 2>&1; adb shell am broadcast -a com.android.systemui.demo -e command clock -e hhmm 1200 >/dev/null 2>&1; for c in '-e command notifications -e visible false' '-e command network -e mobile hide -e sims 0 -e nosim hide -e satellite hide -e wifi show -e level 4 -e fully true' '-e command battery -e level 100 -e plugged false'; do adb shell am broadcast -a com.android.systemui.demo $c >/dev/null 2>&1; done; pkg=io.playarr.mobile; mkdir -p "$O"
adb shell am force-stop $pkg
# Web refs format dates as en-GB ("THU 15 OCTOBER"); the app follows the device region, so pin it for captures.
adb shell cmd locale set-app-locales $pkg --locales en-GB >/dev/null 2>&1
adb shell "run-as $pkg sh -c 'mkdir -p shared_prefs; echo \"<?xml version=\\\"1.0\\\" encoding=\\\"utf-8\\\" standalone=\\\"yes\\\" ?><map><string name=\\\"theme\\\">$T</string></map>\" > shared_prefs/playarr_display.xml'"
# A tap (player, card and actions flows) leaves the emulator in touch mode, where the app's default focus is not requested and a modifier key
# (shift) does not leave it. A D-pad key does, but only when the app window receives it, so start the app, press one, then relaunch on the route;
# without it the Play pill and focus rings capture unfocused.
open() { adb shell am start -n $pkg/.MainActivity >/dev/null; sleep 6; [ -n "${NOKEY:-}" ] || adb shell input keyevent 20; sleep 1; adb shell am force-stop $pkg; adb shell am start -n $pkg/.MainActivity --ez parity_no_insets true --es parity_route "$1" --es parity_clock "$CLOCK" --el parity_pause_at_ms 2000 >/dev/null; sleep "${2:-20}"; adb shell dumpsys activity activities | grep -m1 topResumed | grep -q $pkg || { adb shell am start -n $pkg/.MainActivity --ez parity_no_insets true --es parity_route "$1" --es parity_clock "$CLOCK" >/dev/null; sleep 20; }; }
tap_text() { python3 -I $HERE/uitap.py "$1" "${3:-tap}"; sleep "${2:-1.5}"; }
tap() { adb shell input tap "$1" "$2"; sleep "${3:-1.5}"; }
shot() { sleep "${2:-5}"; adb shell dumpsys input_method | grep -q "mInputShown=true" && { adb shell input keyevent 4; sleep 1.5; }; for i in 1 2 3; do adb shell dumpsys activity activities | grep -m1 topResumed | grep -q $pkg || { echo "not foreground"; sleep 4; continue; }; adb exec-out screencap -p > "$O/$1.png"; if [ "$(stat -c%s "$O/$1.png")" -gt 20000 ] && python3 -I -c "import sys;d=open(sys.argv[1],'rb').read();assert d[:8]==b'\\x89PNG\\r\\n\\x1a\\n' and d[-8:-4]==b'IEND'" "$O/$1.png" 2>/dev/null; then
    adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; if adb shell cat /sdcard/ui.xml | grep -qiE "try again|reach the playarr|couldn.t|could not be loaded|sign in to playarr|isn.t responding|keeps stopping|has stopped|close app|not responding"; then sleep 4; continue; fi
    rm -f "$O/layout/$1.json"; PARITY_PNG_OUT="$O/$1.png" python3 -I "$HERE/../layout.py" "$1" "$(echo "$T" | tr A-Z a-z)" tablet "$O/layout/$1.json" >/dev/null 2>&1 || { echo "layout export failed $1"; rm -f "$O/layout/$1.json"; sleep 2; continue; }; echo "ok $1"; return 0; fi; sleep 2; done; rm -f "$O/$1.png"; echo "FAIL $1"; return 1; }
kseq() { local k n; for k in "$@"; do n=1; case $k in *"*"*) n=${k#*\*}; k=${k%\**};; esac; for i in $(seq $n); do case $k in left) c=21;; right) c=22;; up) c=19;; down) c=20;; select) c=23;; back) c=4;; select:long) adb shell input keyevent --longpress 23; sleep 1.2; continue;; esac; adb shell input keyevent $c; sleep 0.5; done; done; sleep 1.5; }
run() { case $1 in
  home) open home; adb shell input tap 1700 60; sleep 1.5; shot $1 ;;
  movies) open home 20; adb shell input keyevent 59; kseq left down*12 up*6 select; python3 -I $HERE/uiexpect.py '[0-9,]+ titles' || { echo "wrong screen movies"; return 1; }; shot $1 ;;
  series) open home 20; adb shell input keyevent 59; kseq left down*12 up*7 select; python3 -I $HERE/uiexpect.py '[0-9,]+ titles' || { echo "wrong screen series"; return 1; }; shot $1 ;;
  music) open home 20; adb shell input keyevent 59; kseq left down*12 up*5 select; python3 -I $HERE/uiexpect.py '[0-9,]+ (titles|artists)' || { echo "wrong screen music"; return 1; }; shot $1 ;;
  search) open home 20; adb shell input keyevent 59; kseq left down*12 up*9 select; sleep 2; python3 -I $HERE/uiexpect.py 'Search your libraries' || { adb shell input keyevent 4; sleep 2; python3 -I $HERE/uiexpect.py 'Search your libraries'; } || { echo "wrong screen search"; return 1; }; shot $1 ;;
  settings) open settings 20; adb shell input keyevent 59; sleep 2; python3 -I $HERE/uiexpect.py 'Colour theme' || { echo "wrong screen settings"; return 1; }; shot $1 ;;
  profiles) open home 20; adb shell input keyevent 59; kseq left down*12 select; python3 -I $HERE/uiexpect.py 'Who.s watching' || { echo "wrong screen profiles"; return 1; }; shot $1 ;;
  calendar-month) NOKEY=1 open "calendar?query=view%3Dmonth" 25; sleep 3; python3 -I $HERE/uiexpect.py 'Calendar' || { echo "wrong screen calendar-month"; return 1; }; shot $1 ;;
  calendar-week) NOKEY=1 open "calendar?query=view%3Dweek" 25; sleep 3; python3 -I $HERE/uiexpect.py 'Calendar' || { echo "wrong screen calendar-week"; return 1; }; shot $1 ;;
  calendar-agenda) NOKEY=1 open "calendar?query=view%3Dagenda" 25; sleep 3; python3 -I $HERE/uiexpect.py 'Calendar' || { echo "wrong screen calendar-agenda"; return 1; }; shot $1 ;;
  calendar-link) NOKEY=1 open "calendar?query=panel%3Dsubscription" 25; python3 -I $HERE/uiexpect.py 'Your personal calendar link' || { echo "wrong screen calendar-link"; return 1; }; sleep 3; shot $1 ;;
  filters) open home 20; adb shell input keyevent 59; kseq left down*12 up*6 select; sleep 3; adb shell input tap 2495 298; sleep 2; python3 -I $HERE/uiexpect.py 'Sort by|Library controls' || { echo "wrong screen filters"; return 1; }; shot $1 ;;
  actions) for try in 1 2 3; do
      open home 20; adb shell input keyevent 59; kseq left down*12 up*6 select; sleep 3; kseq right; adb shell input keyevent --longpress 23; sleep 1.5
      # Key long-press did not open the drawer before; fall back to a 1.5 s touch hold on the card, then insist the drawer is on screen.
      python3 -I $HERE/uiexpect.py 'Mark as Watched' || { adb shell input swipe ${ACT_X:-1939} ${ACT_Y:-256} ${ACT_X:-1939} ${ACT_Y:-256} 1500; sleep 1.5; }
      python3 -I $HERE/uiexpect.py 'Mark as Watched' || { echo "wrong screen actions (drawer not open)"; continue; }
      # The web ref opens the actions of the second library card: retry from a fresh launch when a loaded host dropped the Right key and another card opened.
      python3 -I $HERE/uiexpect.py 'Amber Cathedral 18' && { shot $1; return $?; }; echo "wrong title in the actions drawer"
    done; return 1 ;;
  actions-bottom) open home 20; adb shell input keyevent 59; kseq left down*12 up*6 select; sleep 3; kseq right; adb shell input keyevent --longpress 23; sleep 1.5
    # Key long-press did not open the drawer before; fall back to a 1.5 s touch hold on the card, then insist the drawer is on screen.
    python3 -I $HERE/uiexpect.py 'Mark as Watched' || { adb shell input swipe ${ACT_X:-1939} ${ACT_Y:-256} ${ACT_X:-1939} ${ACT_Y:-256} 1500; sleep 1.5; }
    python3 -I $HERE/uiexpect.py 'Mark as Watched' || { echo "wrong screen actions (drawer not open)"; return 1; }; kseq down*8; shot $1 ;;
  film-detail) open experience-detail/ca309574-c0f4-4564-bb54-4512eab7e531 20; adb shell input keyevent 59; sleep 4; shot $1 ;;
  series-detail) open experience-detail/7ab4ce97-d59e-43d6-8e03-31d4d29a5c90 20; adb shell input keyevent 59; sleep 4; shot $1 ;;
  player-controls) open movies; python3 -I $HERE/uiexpect.py '[0-9,]+ titles' || { echo "wrong screen movies grid"; return 1; }; tap ${CARD_X:-1254} ${CARD_Y:-371} 6; adb logcat -c; tap_text "Resume.*|Play" 3
    # Capture only once the debug player reports 2.000 s twice, so every run shows the same frame.
    ok=0; for w in $(seq 1 60); do [ "$(adb logcat -d -s PlayarrParity:I | grep -c 'player positionMs=2000$')" -ge 2 ] && { ok=1; break; }; sleep 1; done
    [ $ok = 1 ] || { echo "player did not settle at 2.000 s"; return 1; }
    # The grey buffered bar is clamped to 22.84 s in parity builds: wait until the player has buffered at least that, or its width depends on host load.
    ok=0; for w in $(seq 1 90); do b=$(adb logcat -d -s PlayarrParity:I | grep -o 'player bufferedMs=[0-9]*' | tail -1 | cut -d= -f2); [ "${b:-0}" -ge 22840 ] && { ok=1; break; }; sleep 1; done
    [ $ok = 1 ] || { echo "player did not buffer 22.84 s"; return 1; }
    # The harness pauses at 2 s, but the chrome hides 5 s after playback starts: when startup is slow (loaded host) the chrome is gone by the
    # time the player is paused and never returns. A touch on the surface shows it again without toggling playback.
    for w in 1 2 3 4; do python3 -I $HERE/uiexpect.py 'Pause|Seek|Subtitles|Audio' && break; [ $w = 2 ] && { adb shell input tap 1280 800; sleep 2; }; [ $w = 4 ] && { echo "wrong screen player-controls"; return 1; }; done; shot $1 1 || return 1
    # A black video surface (decoder not yet presenting the frame) is a bad capture: the colour bars average well above 60.
    python3 -I -c "import sys;from PIL import Image,ImageStat;im=Image.open(sys.argv[1]).convert('L').crop((0,200,2560,1400));sys.exit(0 if ImageStat.Stat(im).mean[0]>60 else 1)" "$O/$1.png" || { echo "player video not presented"; rm -f "$O/$1.png"; return 1; } ;;
  home-last) open home 20; adb shell input keyevent 59; kseq right*2 down; kseq right*80; shot $1 ;;
  home-row2) open home 20; adb shell input keyevent 59; kseq right down*2 right; shot $1 ;;
  movies-last) open home 20; adb shell input keyevent 59; kseq left down*12 up*6 select down*40; shot $1 ;;
  movies-lastcol) open home 20; adb shell input keyevent 59; kseq left down*12 up*6 select right*2 down*3; shot $1 ;;
  series-detail-last) open experience-detail/7ab4ce97-d59e-43d6-8e03-31d4d29a5c90 20; adb shell input keyevent 59; sleep 4; kseq down right*30; shot $1 ;;
  film-detail-chapters) open experience-detail/ca309574-c0f4-4564-bb54-4512eab7e531 20; adb shell input keyevent 59; sleep 4; kseq down right; shot $1 ;;
  nav-focus) open home 20; adb shell input keyevent 59; kseq left down*2; shot $1 ;;
  settings-list) open settings 20; adb shell input keyevent 59; sleep 2; kseq down*2; shot $1 ;;
  filters-bottom) open home 20; adb shell input keyevent 59; kseq left down*12 up*6 select right*12 up select; kseq down*40; shot $1 ;;
  player-focus) open movies; python3 -I $HERE/uiexpect.py '[0-9,]+ titles' || { echo "wrong screen movies grid"; return 1; }; tap ${CARD_X:-1254} ${CARD_Y:-371} 6; tap_text "Resume.*|Play" 25; kseq right*3; shot $1 1 ;;
  *) echo "unknown $1";;
esac; }
for s in "$@"; do for attempt in 1 2 3; do run "$s" && break; done; done
