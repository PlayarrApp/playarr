#!/usr/bin/env bash
# usage: cap.sh <name> <out.png> [scale-div]; full-size capture
H=$(dirname "$0"); "$H/vnc.sh" "$1" capture "$2" 2>/dev/null
[ -n "$3" ] && "$H/venv/bin/python" -c "from PIL import Image;import sys;i=Image.open('$2');i.resize((i.width//$3,i.height//$3)).save('/tmp/claude-1000/small.png')"
