#!/usr/bin/env bash
# Builds the static Nunito Sans instances the Sailfish client embeds (Qt 5.6 draws a variable font at its default weight only),
# one file per weight the web phone layout uses, from the shared parity font in docs/parity/fonts.
#   build-fonts.sh [python-with-fonttools]      (python3 -m venv v && v/bin/pip install fonttools brotli)
set -euo pipefail
py=${1:-python3}
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)
src="$root/docs/parity/fonts/NunitoSans-wght-web.ttf"
out="$root/clients/sailfish/fonts"
tmp=$(mktemp -d)
for w in 300 400 480 580 610 640 680 700 720 760 820 900; do
  "$py" -m fontTools.varLib.instancer "$src" wght=$w -q -o "$tmp/i.ttf"
  "$py" - "$tmp/i.ttf" "$out/NunitoSans-$w.ttf" "$w" <<'PY'
import sys
from fontTools.ttLib import TTFont
src, dst, w = sys.argv[1:4]
f = TTFont(src)
fam = "Nunito Sans W" + w
for rec in f["name"].names:
    if rec.nameID in (1, 16): rec.string = fam
    elif rec.nameID in (4,): rec.string = fam
    elif rec.nameID == 6: rec.string = fam.replace(" ", "") + "-Regular"
    elif rec.nameID in (2, 17): rec.string = "Regular"
f["OS/2"].usWeightClass = 400   # keeps the files apart in Qt's font database
f.save(dst)
PY
done
rm -rf "$tmp"
ls -l "$out"
