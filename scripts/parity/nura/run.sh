#!/usr/bin/env bash
# usage: run.sh <outdir> [theme...]   Full Nura parity run on the pmbootstrap qemu VM: sign in to the static server, capture
# the 15 screens in dark and light with the pinned clock, score against the web refs, and publish to the legend dev dir.
# Needs (see README.md): the VM running headless, PLAYARR_NURA_SERVER (static server URL as the VM sees it),
# PLAYARR_PARITY_STATIC_PASSWORD (~/.secrets), PARITY_ROOT (legend scratch root), PLAYARR_NURA_KEY if not run/pmkey,
# and `npm ci` in scripts/parity. Env: BRANCH, SHA, PR (build.json), PUBLISH=0 to skip the legend copy, SKIP_SIGNIN=1
# when the app is already signed in (PLAYARR_NURA_EXPECTED_SUB then names the account id).
set -euo pipefail
H=$(cd -- "$(dirname -- "$0")" && pwd)
O=${1:?usage: run.sh <outdir> [theme...]}; shift
THEMES=${*:-dark light}
: "${PARITY_ROOT:?}"
export PLAYARR_CONTROL=${PLAYARR_CONTROL:-/tmp/pa-route} PLAYARR_CAPTURE_IDENTITY_GUARD=$H/guard.sh
export PLAYARR_PARITY_CLOCK=${PLAYARR_PARITY_CLOCK:-2026-10-07T12:00:00Z}
FILM=ca309574-c0f4-4564-bb54-4512eab7e531 SERIES=7ab4ce97-d59e-43d6-8e03-31d4d29a5c90
if [ -z "${SKIP_SIGNIN:-}" ]; then
  PLAYARR_NURA_EXPECTED_SUB=$("$H/signin.py" | sed -n 's/^sub //p')
  export PLAYARR_NURA_EXPECTED_SUB
fi
mkdir -p "$O"
# Layout JSON (docs/parity/LAYOUT.md) of the screen now showing, written by the app itself: <outdir>/<theme>/layout/<screen>.json.
layout() {
  local theme=$1 name=$2 f=/tmp/pa-layout.json
  "$H/pmssh.sh" "rm -f $f; printf %s 'layout:$name:$f' > $PLAYARR_CONTROL" </dev/null
  for _ in $(seq 1 20); do "$H/pmssh.sh" "[ -s $f ]" </dev/null && break; sleep 1; done
  mkdir -p "$O/$theme/layout"; "$H/pmssh.sh" "cat $f" </dev/null > "$O/$theme/layout/$name.json"
}
for t in $THEMES; do
  rm -f -- "$O/$t"/*.png
  "$H/pmrun.sh" </dev/null; sleep 15; "$H/pmfocus.sh"
  # One route per call, each retried: a display repaint glitch can outlast one stability window.
  for r in home movies series music calendar-month calendar-week calendar-agenda search "film:$FILM" "series-detail:$SERIES" settings filters profiles actions; do
    for try in 1 2 3; do WAIT=${WAIT:-45} "$H/pmcap3.sh" "$O/$t" "theme:$t" "$r" </dev/null && break; [ "$try" = 3 ] && exit 1; done
    case $r in film:*) n=film-detail;; series-detail:*) n=series-detail;; *) n=$r;; esac
    layout "$t" "$n"
  done
  # Player: its own start, paused at 2 s with the controls pinned, like the web ref. Colour bars trip the green guard.
  # Captured only once the app's own tree shows the player up and paused at 2.000 s (its time label reads "0:02 / 1:00").
  for try in 1 2 3; do
    PLAYARR_KEEP_CONTROLS=1 PLAYARR_PARITY_PAUSE_MS=2000 "$H/pmrun.sh" </dev/null; sleep 15; "$H/pmfocus.sh"
    PLAYARR_CAPTURE_GREEN_CHECK=true "$H/pmcap3.sh" "$O/$t" "theme:$t" player </dev/null || continue
    layout "$t" player-controls
    grep -q '"text":"0:02 / 1:00"' "$O/$t/layout/player-controls.json" && break
    [ "$try" = 3 ] && { echo "player never reached 0:02 / 1:00" >&2; exit 1; }
  done
  for f in "$O/$t"/film_*.png; do mv -- "$f" "$O/$t/film.png"; done
  for f in "$O/$t"/series-detail_*.png; do mv -- "$f" "$O/$t/series-detail.png"; done
  (cd "$H/.." && PARITY_ROOT=$PARITY_ROOT node nura/score.mjs "$O/$t" "$t") | tee "$O/score-$t.txt"
done
if [ "${PUBLISH:-1}" = 1 ]; then
  D=$PARITY_ROOT/postmarketos/dev
  for t in $THEMES; do
    L=$D/layout/$t
    mkdir -p "$L"; cp -- "$O/$t/layout"/*.json "$L/"
  done
  python3 -I - "$O" "$D" "$THEMES" <<'PY'
import sys, glob, os
from PIL import Image
R, D, themes = sys.argv[1:]
ren = {"film": "film-detail", "player": "player-controls"}
for t in themes.split():
    out = D + ("/light" if t == "light" else "")
    os.makedirs(out, exist_ok=True)
    for f in glob.glob(f"{R}/{t}/*.png"):
        n = os.path.basename(f)[:-4]
        Image.open(f).convert("RGB").crop((0, 64, 720, 1410)).save(f"{out}/{ren.get(n, n)}.png")
PY
  printf '{"branch":"%s","sha":"%s","pr":"%s","captured_at":"%s","server":"static server"}\n' "${BRANCH:-}" "${SHA:-}" "${PR:-}" "$(date -u +%FT%TZ)" > "$D/build.json"
fi
