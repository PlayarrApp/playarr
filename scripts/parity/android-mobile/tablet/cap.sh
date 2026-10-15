#!/usr/bin/env bash
HERE=$(cd "$(dirname "$0")" && pwd)
# Tablet capture driver (emulator-5568, 2560x1600, sideload debug build): cap.sh <outdir> <Dark|Light> <screen...>. Home-focus screens (home-last, movies-last, nav-focus ...) drive focus with keys. Reset the Device Test account progress (reset-deck-canonical.mjs) before capturing home.
S_STATE=/dev/null
set -a; eval "$(grep -E "^PLAYARR_DEVICE_TEST_(USERNAME|PASSWORD|SERVER_URL)=" ~/.secrets)"; set +a
export PATH=$HOME/Android/Sdk/platform-tools:$PATH ANDROID_SERIAL=emulator-5568
O=$1; T=$2; shift 2; pkg=io.playarr.mobile; mkdir -p "$O"
adb shell am force-stop $pkg
# Web refs format dates as en-GB ("THU 15 OCTOBER"); the app follows the device region, so pin it for captures.
adb shell cmd locale set-app-locales $pkg --locales en-GB >/dev/null 2>&1
adb shell "run-as $pkg sh -c 'mkdir -p shared_prefs; echo \"<?xml version=\\\"1.0\\\" encoding=\\\"utf-8\\\" standalone=\\\"yes\\\" ?><map><string name=\\\"theme\\\">$T</string></map>\" > shared_prefs/playarr_display.xml'"
open() { adb shell am force-stop $pkg; adb shell am start -n $pkg/.MainActivity --ez parity_no_insets true --es parity_route "$1" --el parity_pause_at_ms 2000 >/dev/null; sleep "${2:-20}"; adb shell dumpsys activity activities | grep -m1 topResumed | grep -q $pkg || { adb shell am start -n $pkg/.MainActivity --ez parity_no_insets true --es parity_route "$1" >/dev/null; sleep 20; }; }
tap_text() { python3 -I $HERE/uitap.py "$1" "${3:-tap}"; sleep "${2:-1.5}"; }
tap() { adb shell input tap "$1" "$2"; sleep "${3:-1.5}"; }
shot() { sleep "${2:-2}"; for i in 1 2 3; do adb shell dumpsys activity activities | grep -m1 topResumed | grep -q $pkg || { echo "not foreground"; sleep 4; continue; }; adb exec-out screencap -p > "$O/$1.png"; if [ "$(stat -c%s "$O/$1.png")" -gt 20000 ] && python3 -I -c "import sys;d=open(sys.argv[1],'rb').read();assert d[:8]==b'\\x89PNG\\r\\n\\x1a\\n' and d[-8:-4]==b'IEND'" "$O/$1.png" 2>/dev/null; then
    adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; if adb shell cat /sdcard/ui.xml | grep -qiE "try again|reach the playarr|couldn.t|could not be loaded|sign in to playarr|isn.t responding|keeps stopping|has stopped|close app|not responding"; then sleep 4; continue; fi
    echo "ok $1"; return 0; fi; sleep 2; done; rm -f "$O/$1.png"; echo "FAIL $1"; return 1; }
kseq() { local k n; for k in "$@"; do n=1; case $k in *"*"*) n=${k#*\*}; k=${k%\**};; esac; for i in $(seq $n); do case $k in left) c=21;; right) c=22;; up) c=19;; down) c=20;; select) c=23;; back) c=4;; select:long) adb shell input keyevent --longpress 23; sleep 1.2; continue;; esac; adb shell input keyevent $c; sleep 0.5; done; done; sleep 1.5; }
run() { case $1 in
  home) open home; shot $1 ;;
  movies) open home 20; adb shell input keyevent 59; kseq left down*12 up*6 select; python3 -I $HERE/uiexpect.py '[0-9,]+ titles' || { echo "wrong screen movies"; return 1; }; shot $1 ;;
  series) open home 20; adb shell input keyevent 59; kseq left down*12 up*7 select; python3 -I $HERE/uiexpect.py '[0-9,]+ titles' || { echo "wrong screen series"; return 1; }; shot $1 ;;
  music) open home 20; adb shell input keyevent 59; kseq left down*12 up*5 select; python3 -I $HERE/uiexpect.py '[0-9,]+ (titles|artists)' || { echo "wrong screen music"; return 1; }; shot $1 ;;
  search) open home 20; adb shell input keyevent 59; kseq left down*12 up*9 select; sleep 2; adb shell input keyevent 4; sleep 2; python3 -I $HERE/uiexpect.py 'Search your libraries' || { echo "wrong screen search"; return 1; }; shot $1 ;;
  settings) open settings 20; adb shell input keyevent 59; sleep 2; python3 -I $HERE/uiexpect.py 'Colour theme' || { echo "wrong screen settings"; return 1; }; shot $1 ;;
  profiles) open home 20; adb shell input keyevent 59; kseq left down*12 select; python3 -I $HERE/uiexpect.py 'Who.s watching' || { echo "wrong screen profiles"; return 1; }; shot $1 ;;
  calendar-month) open home 20; adb shell input keyevent 59; kseq left down*12 up*1 select down select down select back; python3 -I $HERE/uiexpect.py 'Pick start date' && { adb shell input keyevent 4; sleep 2; }; python3 -I $HERE/uiexpect.py 'Calendar' || { echo "wrong screen calendar-month"; return 1; }; shot $1 ;;
  calendar-week) open home 20; adb shell input keyevent 59; kseq left down*12 up*1 select down select down left select back; python3 -I $HERE/uiexpect.py 'Pick start date' && { adb shell input keyevent 4; sleep 2; }; python3 -I $HERE/uiexpect.py 'Calendar' || { echo "wrong screen calendar-week"; return 1; }; shot $1 ;;
  calendar-agenda) open home 20; adb shell input keyevent 59; kseq left down*12 up*1 select; python3 -I $HERE/uiexpect.py 'Calendar' || { echo "wrong screen calendar-agenda"; return 1; }; shot $1 ;;
  filters) open home 20; adb shell input keyevent 59; kseq left down*12 up*6 select right*12 up select; python3 -I $HERE/uiexpect.py 'Sort by|Library controls' || { echo "wrong screen filters"; return 1; }; shot $1 ;;
  actions) open home 20; adb shell input keyevent 59; kseq left down*12 up*6 select right; adb shell input keyevent --longpress 23; sleep 1.5
    # Key long-press did not open the drawer before; fall back to a 1.5 s touch hold on the card, then insist the drawer is on screen.
    python3 -I $HERE/uiexpect.py 'Mark as Watched' || { adb shell input swipe ${ACT_X:-1939} ${ACT_Y:-256} ${ACT_X:-1939} ${ACT_Y:-256} 1500; sleep 1.5; }
    python3 -I $HERE/uiexpect.py 'Mark as Watched' || { echo "wrong screen actions (drawer not open)"; return 1; }; shot $1 ;;
  film-detail) open experience-detail/ca309574-c0f4-4564-bb54-4512eab7e531 20; adb shell input keyevent 59; sleep 4; shot $1 ;;
  series-detail) open experience-detail/7ab4ce97-d59e-43d6-8e03-31d4d29a5c90 20; adb shell input keyevent 59; sleep 4; shot $1 ;;
  player-controls) open movies; tap ${CARD_X:-190} ${CARD_Y:-330} 6; tap_text "Resume.*|Play" 25; python3 -I $HERE/uiexpect.py 'Pause|Seek|Subtitles|Audio' || { echo "wrong screen player-controls"; return 1; }; shot $1 1 ;;
  home-last) open home 20; adb shell input keyevent 59; kseq right*2 down; kseq right*80; shot $1 ;;
  home-row2) open home 20; adb shell input keyevent 59; kseq right down*2 right; shot $1 ;;
  movies-last) open home 20; adb shell input keyevent 59; kseq left down*12 up*6 select down*40; shot $1 ;;
  movies-lastcol) open home 20; adb shell input keyevent 59; kseq left down*12 up*6 select right*2 down*3; shot $1 ;;
  series-detail-last) open experience-detail/7ab4ce97-d59e-43d6-8e03-31d4d29a5c90 20; adb shell input keyevent 59; sleep 4; kseq down right*30; shot $1 ;;
  film-detail-chapters) open experience-detail/ca309574-c0f4-4564-bb54-4512eab7e531 20; adb shell input keyevent 59; sleep 4; kseq down right; shot $1 ;;
  nav-focus) open home 20; adb shell input keyevent 59; kseq left down*2; shot $1 ;;
  settings-list) open settings 20; adb shell input keyevent 59; sleep 2; kseq down*2; shot $1 ;;
  *) echo "unknown $1";;
esac; }
for s in "$@"; do for attempt in 1 2 3; do run "$s" && break; done; done
