#!/usr/bin/env bash
# Focus crop audit for the Xbox VM: drives focus to the first, a middle and the last visible item of Home and the
# Movies, Series and Music grids and saves one 1920x1080 shot each to <out>/<theme>-<screen>-<position>.png, for
# checking that the ring and glow are fully visible. Usage: crop-audit.sh <vm-dir> <out-dir> <theme-label>
# <vm-dir> holds qmp.py and gssh (the slot 8 VM tools). Hold the VM lock and the heavy-job slot before running.
set -euo pipefail
V=$1; O=$2; T=$3; mkdir -p "$O"
q() { python3 "$V/qmp.py" "$@"; }
shot() { q move 1919 600 >/dev/null; sleep 1; q shot "$O/$T-$1.ppm" >/dev/null; magick "$O/$T-$1.ppm" "$O/$T-$1.png"; }
"$V/gssh" 'taskkill /f /im Playarr.Xbox.exe' >/dev/null 2>&1 || true; sleep 2
"$V/gssh" 'schtasks /run /tn PlayarrApp' >/dev/null; sleep 28
q click 817 494 >/dev/null; sleep 22                       # profile tile -> Home
shot home-first; q keys right right right >/dev/null; sleep 2; shot home-third; q keys down >/dev/null; sleep 2; shot home-rail2
for item in "movies 472" "series 400" "music 544"; do
  set -- $item; q click 81 "$2" >/dev/null; sleep 25
  shot "$1-first"; q keys right right >/dev/null; sleep 1.5; shot "$1-col3"
  q keys down down down down >/dev/null; sleep 2; shot "$1-row5-col3"; q keys left left >/dev/null; sleep 1; shot "$1-row5-col1"
done
