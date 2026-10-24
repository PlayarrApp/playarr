#!/usr/bin/env bash
# usage: display.sh postmarketos capture <out.png> | move <x> <y> click 1 [pause N capture <out.png>]
# Headless QEMU display I/O for the Nura VM (QMP screendump and tablet taps, no VNC); see display.py.
set -euo pipefail
H=$(cd -- "$(dirname -- "$0")" && pwd)
shift
while [ "$#" -gt 0 ]; do
  case $1 in
    capture) python3 -I "$H/display.py" capture "$2"; shift 2 ;;
    move) x=$2; y=$3; shift 3 ;;
    click) python3 -I "$H/display.py" tap "$x" "$y"; shift 2 ;;
    pause) sleep "$2"; shift 2 ;;
    *) echo "display.sh: unknown command $1" >&2; exit 2 ;;
  esac
done
