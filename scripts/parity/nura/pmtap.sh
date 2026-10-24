#!/usr/bin/env bash
# usage: pmtap.sh X Y [wait]   tap the Nura VM display (logical pixels 720x1440) then wait for the slow repaint
"$(dirname "$0")/display.sh" postmarketos move "$1" "$2" click 1 2>&1 | grep -vi "warn\|encr"; sleep "${3:-20}"
