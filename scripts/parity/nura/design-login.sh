#!/usr/bin/env bash
# usage: design-login.sh <outdir> <dark|light>   Capture the signed-out pairing screen ("Link this phone") as <outdir>/login.png.
# The broker issues a new QR and code on every start, so the QR modules and the code text are masked (flat fill) after the capture.
# Moves the VM's session file aside during the capture and restores it afterwards; needs the app theme set by `theme:` beforehand.
set -euo pipefail
H=$(cd -- "$(dirname -- "$0")" && pwd)
O=${1:?}; T=${2:?}
"$H/pmssh.sh" 'killall playarr-mobile 2>/dev/null; mv ~/.local/share/playarr-mobile/sessions.json ~/sessions.keep' </dev/null
trap '"$H/pmssh.sh" "mv ~/sessions.keep ~/.local/share/playarr-mobile/sessions.json" </dev/null' EXIT
"$H/pmssh.sh" "sed -i 's/\"theme\": *\"[a-z]*\"/\"theme\":\"$T\"/' ~/.local/share/playarr-mobile/settings.json" </dev/null
"$H/pmrun.sh" </dev/null; sleep 25; "$H/pmfocus.sh"; sleep 10
mkdir -p "$O"; "$H/cap.sh" postmarketos "$O/login.png" >/dev/null 2>&1
python3 -I - "$O/login.png" <<'PY'
import sys
from PIL import Image, ImageDraw
im = Image.open(sys.argv[1]).convert("RGB")
bg = im.getpixel((20, 1070))
d = ImageDraw.Draw(im)
d.rectangle((130, 490, 590, 950), fill=(128, 128, 128))
d.rectangle((60, 1025, 660, 1105), fill=bg)
im.save(sys.argv[1])
PY
