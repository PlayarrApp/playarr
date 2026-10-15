#!/usr/bin/env bash
# usage: pmfocus.sh  if Phosh is showing the app overview (green background), tap the app card to bring the app forward
H=$(dirname "$0"); T=$(mktemp -p /run/user/1000 pmfocus.XXXX.png)
"$H/cap.sh" postmarketos "$T" >/dev/null 2>&1
G=$("$H/venv/bin/python" -c "
from PIL import Image
im=Image.open('$T').convert('RGB'); r,g,b=im.getpixel((360,1000)); print(1 if g>r+40 and g>b+20 else 0)")
rm -f "$T"
if [ "$G" = 1 ]; then "$H/vnc.sh" postmarketos move 270 330 click 1 >/dev/null 2>&1; sleep 15; echo "tapped card"; else echo "app in front"; fi
