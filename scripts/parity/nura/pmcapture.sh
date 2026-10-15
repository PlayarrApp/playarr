#!/usr/bin/env bash
# usage: pmcapture.sh <outdir> <theme dark|light>  drive the native app through the legend screens and capture each (review before publishing)
H=$(dirname "$0"); O=$1; T=$2; mkdir -p "$O"
S() { "$H/cap.sh" postmarketos "$O/$1.png" >/dev/null 2>&1; }
"$H/pmssh.sh" "mkdir -p ~/.local/share/playarr-mobile; echo '{\"theme\":\"$T\"}' > ~/.local/share/playarr-mobile/settings.json" 
GSK=cairo "$H/pmrun.sh" >/dev/null 2>&1; sleep 30
"$H/pmtap.sh" 232 360 50; S profiles-pick
"$H/pmtap.sh" 232 360 50; S home
"$H/pmtap.sh" 480 1325 40; S movies
"$H/pmtap.sh" 600 1325 40; S series
"$H/pmtap.sh" 240 1325 25; "$H/pmtap.sh" 360 190 10; "$H/pmtype.py" "bro" noenter; sleep 45; S search
"$H/pmtap.sh" 360 1325 30; "$H/pmtap.sh" 300 350 45; S film-detail
"$H/pmtap.sh" 165 888 50; "$H/vnc.sh" postmarketos move 360 800 click 1 pause 2 capture "$O/player-controls.png" >/dev/null 2>&1
"$H/pmtap.sh" 96 153 25; "$H/pmtap.sh" 45 108 25
"$H/pmtap.sh" 600 1325 40; "$H/pmtap.sh" 110 330 45; S series-detail
"$H/pmtap.sh" 45 108 25
"$H/pmtap.sh" 120 1325 35; S profiles
"$H/pmtap.sh" 360 606 35; S settings
echo done > "$O/DONE"
