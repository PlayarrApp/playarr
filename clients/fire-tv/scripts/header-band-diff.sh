#!/bin/bash
# Header-band diff (13.807 part B): usage header-band-diff.sh <web-dir> <dev-dir> [theme...]; dirs hold tv/<theme>/<id>.png.
# Compares the top 220 px of each 1920x1080 capture (clock masked) and prints the share of pixels differing by more than 10%.
set -euo pipefail
W=$1; C=$2; shift 2; T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
for t in ${@:-light dark}; do for f in "$C"/tv/$t/*.png; do id=$(basename "$f" .png); w=$W/tv/$t/$id.png; [ -f "$w" ] || continue
  for p in "$f $T/a.png" "$w $T/b.png"; do set -- $p; magick "$1" -crop 1920x220+0+0 +repage -fill black -draw 'rectangle 476,62 642,102' "$2"; done
  n=$(magick compare -fuzz 10% -metric AE "$T/a.png" "$T/b.png" null: 2>&1 | awk '{print $1}')
  echo "$t $id $(awk "BEGIN{printf \"%.2f\", 100*$n/(1920*220)}")%"
done; done
