#!/usr/bin/env bash
# Design-report capture of every phone screen (719x1558 at 295 dpi), PNG only, no layout export.
# design-capture-phone.sh <outroot> <Dark|Light> <screen...>   writes <outroot>/<dark|light>/<screen>.png
# Signed in as the static server's account, pinned fixture clock, debug launch extras as the parity driver.
HERE=$(cd "$(dirname "$0")" && pwd)
export PATH=$HOME/Android/Sdk/platform-tools:$PATH ANDROID_SERIAL=${ANDROID_SERIAL:-emulator-5562}
adb() { local rc n; for n in 1 2; do timeout 30 "$HOME/Android/Sdk/platform-tools/adb" "$@"; rc=$?; [ $rc -ne 124 ] && return $rc; done; return 124; }
adb shell service call alarm 3 s16 UTC >/dev/null 2>&1
ROOT=$1; T=$2; shift 2; TL=$(echo "$T" | tr A-Z a-z); O=$ROOT/$TL; mkdir -p "$O"
adb shell settings put global sysui_demo_allowed 1 >/dev/null 2>&1; adb shell am broadcast -a com.android.systemui.demo -e command enter >/dev/null 2>&1; adb shell am broadcast -a com.android.systemui.demo -e command clock -e hhmm 1200 >/dev/null 2>&1
pkg=io.playarr.mobile
CLOCK=${PARITY_CLOCK:-2026-10-07T12:00:00Z}
adb reverse tcp:18495 tcp:18495 >/dev/null 2>&1
adb shell am force-stop $pkg
adb shell cmd locale set-app-locales $pkg --locales en-GB >/dev/null 2>&1
setTheme() { adb shell "run-as $pkg sh -c 'mkdir -p shared_prefs; echo \"<?xml version=\\\"1.0\\\" encoding=\\\"utf-8\\\" standalone=\\\"yes\\\" ?><map><string name=\\\"theme\\\">$T</string></map>\" > shared_prefs/playarr_display.xml'"; }
setTheme
open() { adb shell am force-stop $pkg; adb shell am start -n $pkg/.MainActivity --ez parity_no_insets true --es parity_route "$1" --es parity_clock $CLOCK --el parity_pause_at_ms 2000 >/dev/null; sleep "${2:-14}"; }
tapd() { python3 -I $HERE/phone/uitap.py "$1" "${2:-tap}"; sleep "${3:-1.5}"; }
expect() { python3 -I $HERE/phone/uiexpect.py "$1"; }
has() { adb shell "rm -f /sdcard/ui.xml; uiautomator dump /sdcard/ui.xml >/dev/null; cat /sdcard/ui.xml" | grep -qE "$1"; }
# shot <id> [settle seconds]: keep the keyboard open when KEEPIME=1, otherwise close it.
shot() { sleep "${2:-5}"; [ -n "${KEEPIME:-}" ] || { adb shell dumpsys input_method | grep -q "mInputShown=true" && { adb shell input keyevent 4; sleep 1.5; }; }
  for i in 1 2 3; do adb shell dumpsys activity activities | grep -m1 topResumed | grep -q $pkg || { echo "not foreground"; sleep 4; continue; }
    adb exec-out screencap -p > "$O/$1.png"
    if [ "$(stat -c%s "$O/$1.png")" -gt 20000 ]; then
      if has "try again|reach the playarr|couldn.t|could not be loaded|isn.t responding|keeps stopping|has stopped|not responding"; then sleep 4; continue; fi
      echo "ok $TL/$1"; return 0; fi; sleep 2; done; rm -f "$O/$1.png"; echo "FAIL $TL/$1"; return 1; }
settingsPage() { open settings 14; expect 'Appearance' || { echo "wrong screen settings"; return 1; }; if [ -n "${3:-}" ]; then adb shell input swipe 360 1300 360 300 400; sleep 2; fi; tapd "$1" tap 4; expect "$2" || { echo "settings page $1 not open"; return 1; }; shot "$4" 5; }
play() { open experience-detail/ca309574-c0f4-4564-bb54-4512eab7e531 18; expect 'Chapters|Play' || { echo "detail still loading"; return 1; }; adb logcat -c; tapd 'Play' tap 3
  ok=0; for w in $(seq 1 60); do n=$(adb logcat -d -s PlayarrParity:I | grep -c 'player positionMs=2000$'); [ "$n" -ge 2 ] && { ok=1; break; }; sleep 1; done
  [ $ok = 1 ] || { echo "player did not settle at 2.000 s"; return 1; }
  ok=0; for w in $(seq 1 90); do b=$(adb logcat -d -s PlayarrParity:I | grep -o 'player bufferedMs=[0-9]*' | tail -1 | cut -d= -f2); [ "${b:-0}" -ge 22840 ] && { ok=1; break; }; sleep 1; done
  [ $ok = 1 ] || { echo "player did not buffer 22.84 s"; return 1; }; }
run() { case $1 in
  home) open home 16; shot $1 ;;
  movies) open movies 16; expect 'Amber Thicket 3' || { echo "wrong screen movies"; return 1; }; shot $1 ;;
  series) open series 16; expect 'Series' || { echo "wrong screen series"; return 1; }; shot $1 ;;
  music) open music 16; expect 'Music' || { echo "wrong screen music"; return 1; }; shot $1 ;;
  search) open search 14; expect 'Search your libraries' || { echo "wrong screen search"; return 1; }; shot $1 ;;
  settings) open settings 14; expect 'Appearance' || { echo "wrong screen settings"; return 1; }; shot $1 ;;
  profiles) open home 14; tapd 'Open profiles' tap 3; expect 'Who.s watching' || { echo "wrong screen profiles"; return 1; }; shot $1 ;;
  calendar-month) open "calendar?query=view%3Dmonth" 18; expect 'Calendar' || return 1; shot $1 ;;
  calendar-week) open "calendar?query=view%3Dweek" 18; expect 'Calendar' || return 1; shot $1 ;;
  calendar-agenda) open "calendar?query=view%3Dagenda" 18; expect 'Calendar' || return 1; shot $1 ;;
  film-detail) open experience-detail/ca309574-c0f4-4564-bb54-4512eab7e531 18; expect 'Chapters|Play' || { echo "detail still loading"; return 1; }; shot $1 4 ;;
  series-detail) open experience-detail/7ab4ce97-d59e-43d6-8e03-31d4d29a5c90 18; expect 'Season|Episodes|Start|Resume' || { echo "detail still loading"; return 1; }; shot $1 4 ;;
  player-controls) play || return 1
    for w in 1 2 3; do expect 'Mute|Seek|Quality' && break; adb shell input tap 360 500; sleep 3; done
    shot $1 3 || return 1 ;;
  player) play || return 1
    # Controls hidden: the chrome hides itself after a few seconds of playback; if it is still shown, one tap on the surface hides it.
    sleep 7; for w in 1 2 3; do expect 'Mute|Seek|Quality' || break; adb shell input tap 360 500; sleep 4; done
    expect 'Mute|Seek|Quality' && { echo "player controls still shown"; return 1; }
    shot $1 2 || return 1 ;;
  actions) open movies 16; expect 'Amber Thicket 3' || { echo "wrong screen movies"; return 1; }; tapd 'Open 7 Distant Harbour 30' long 2 || { echo 'actions card not found'; return 1; }; expect 'Title actions|Mark as Watched' || { echo 'wrong screen actions'; return 1; }; shot $1 ;;
  filters) open movies 16; tapd '^Filters' tap 2; expect 'Sort by|Library controls|Filters' || { echo "wrong screen filters"; return 1; }; shot $1 ;;
  downloads) open downloads 14; expect 'Downloads' || { echo "wrong screen downloads"; return 1; }; shot $1 ;;
  sites) open sites 14; expect 'Sites' || { echo "wrong screen sites"; return 1; }; shot $1 ;;
  music-detail) open music 16; expect 'Music' || return 1; tapd 'Open Amber Horizon Ensemble' tap 8; expect 'Albums' || { echo "wrong screen music-detail"; return 1; }; shot $1 ;;
  search-results) open search 14; expect 'Search your libraries' || return 1; adb shell input tap 380 221; sleep 2; adb shell input text the; sleep 6; expect 'Crimson Tide 20' || { echo "no results"; return 1; }; shot $1 3 ;;
  search--keyboard) open search 14; expect 'Search your libraries' || return 1; adb shell input tap 380 221; sleep 3; adb shell dumpsys input_method | grep -q "mInputShown=true" || { echo "keyboard not shown"; return 1; }; KEEPIME=1 shot $1 2 ;;
  watchlist) open watchlist 14; expect 'Watchlist|Remove from watchlist' || { echo "wrong screen watchlist"; return 1; }; shot $1 ;;
  requests) open requests 14; expect 'Requests' || { echo "wrong screen requests"; return 1; }; shot $1 ;;
  playlists) open playlists 14; expect 'Playlists' || { echo "wrong screen playlists"; return 1; }; shot $1 ;;
  folders) open folders 14; expect 'Folders' || { echo "wrong screen folders"; return 1; }; shot $1 ;;
  profiles--add) open home 14; tapd 'Open profiles' tap 3; expect 'Who.s watching' || return 1; tapd 'Sign in Add another profile' tap 4; expect 'Sign in' || { echo "add profile not open"; return 1; }; shot $1 ;;
  settings-appearance) settingsPage 'Appearance' 'Choose|Theme|Light|Dark' '' $1 ;;
  settings-profile-avatar) settingsPage 'Profile avatar' 'Avatar|avatar' '' $1 ;;
  settings-language) settingsPage 'Language' 'Language|English' '' $1 ;;
  settings-player) settingsPage 'Player' 'Quality|Subtitle|Audio' '' $1 ;;
  settings-server) settingsPage 'Server connection' 'Server|server' '' $1 ;;
  settings-profile-lock) settingsPage 'Profile lock' 'PIN|lock' '' $1 ;;
  settings-invite) settingsPage 'Invite a friend' 'Invite|invite' '' $1 ;;
  settings-remote) settingsPage 'Phone remote' 'remote|Remote' '' $1 ;;
  settings-your-data) settingsPage 'Your data' 'Export|data' '' $1 ;;
  settings-home) settingsPage 'Customise Home' 'rail|Rail|Home' 1 $1 ;;
  login) adb shell pm clear $pkg >/dev/null; setTheme; adb shell am start -n $pkg/.MainActivity >/dev/null; sleep 12; expect 'Sign in to Playarr|Sign in' || { echo "wrong screen login"; return 1; }; shot $1 ;;
  *) echo "unknown $1" ;;
esac; }
for s in "$@"; do for attempt in 1 2; do run "$s" && break; done; done
