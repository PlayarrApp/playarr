#!/usr/bin/env bash
# One command for the full Roku parity run (screens in both themes, then D-pad) against the static parity server.
#   ROKU_DEV_TARGET=<ip> ROKU_DEV_PASSWORD=<pw> scripts/parity/roku/run.sh <out-dir> [extra suite-run args]
# <out-dir> is the legend candidate dir (for example <legend>/roku/dev). The channel must be signed in as the static account
# (pair it once through <server>/tv/link). The channel clock is pinned through the launch argument parityNow (PARITY_FIXED_NOW).
# The driver has no stable-mode hooks, so the run sets PARITY_STABLE=0; everything else is frozen by the static server.
set -euo pipefail
out=${1:?usage: run.sh <out-dir> [suite-run args]}; shift
here=$(cd "$(dirname "$0")/.." && pwd)
: "${ROKU_DEV_TARGET:?set ROKU_DEV_TARGET}" "${ROKU_DEV_PASSWORD:?set ROKU_DEV_PASSWORD}"
eval "$(node "$here/parity-config.mjs" --shell)"
export PARITY_STABLE=0
cd "$here"
exec node suite-run.mjs --driver drivers/roku.mjs --out "$out" --via route \
  --only screens,dpad \
  --screens home,movies,series,music,calendar-month,calendar-week,calendar-agenda,search,settings,filters,profiles,actions,film-detail,series-detail \
  --checks home-right,home-down,home-down-right,home-left-nav,nav-down,movies-grid-right,movies-grid-down,movies-grid-left-nav,series-grid-down,long-press-actions,nav-right-stage,detail-back \
  "$@"
