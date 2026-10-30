#!/usr/bin/env bash
# One command for the whole Hisense VIDAA parity run on the real TV, against the static parity server (pinned clock 2026-10-07T12:00:00Z):
#   scripts/parity/vidaa/run.sh <out-dir>            # screens in both themes, then the D-pad checks
#   scripts/parity/vidaa/run.sh <out-dir> screens    # screens only
#   scripts/parity/vidaa/run.sh <out-dir> dpad       # D-pad only
# Writes <out-dir>/{dark,light}/<screen>.png, <out-dir>/layout/<theme>/<screen>.json, dpad.json and build.json.
#
# Before it (docs/parity/DEVICES.md, "Hisense VIDAA"): the keepalive service is the TV's only MQTT session, the debug-mirror build is served by
# scripts/vidaa/receiver.py, and the static parity server is up. Environment:
#   PLAYARR_VIDAA_CLI   the remote wrapper that talks to the keepalive broker (never a direct session)
#   PLAYARR_VIDAA_MIRROR receiver base URL as this host reaches it (default http://127.0.0.1:18742)
# Secrets (the mirror token, the parity account) come from the secrets file and are never printed.
set -euo pipefail
out=${1:?usage: run.sh <out-dir> [screens|dpad]}
only=${2:-all}
here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$here"
eval "$(node parity-config.mjs --shell)"
: "${PLAYARR_VIDAA_CLI:?PLAYARR_VIDAA_CLI must point at the vidaa remote wrapper}"
export PARITY_SERVER_URL PARITY_ACCOUNT_NAME PLAYARR_VIDAA_CLI PARITY_STABLE=0 PLAYARR_VIDAA_FIXED_NOW="${PARITY_CLOCK:-2026-10-07T12:00:00Z}"
mkdir -p "$out"
busy=${PLAYARR_VIDAA_BUSY:-}   # optional wrapper that holds the shared busy lock while the suite runs
suite() { ${busy:+$busy} node suite-run.mjs --driver ./drivers/vidaa.mjs --via keys --skip-player --out "$out" "$@"; }
screens=home,movies,series,music,calendar-month,calendar-week,calendar-agenda,search,film-detail,series-detail,settings,filters,profiles,player-controls,actions
if [ "$only" = all ] || [ "$only" = screens ]; then suite --only screens --screens "$screens"; fi
if [ "$only" = all ] || [ "$only" = dpad ]; then suite --only dpad; fi
repo="$(git rev-parse --show-toplevel)"
printf '{"branch":"%s","sha":"%s","pr":%s,"captured_at":"%s","server":"static server"}\n' \
  "$(git -C "$repo" branch --show-current)" "$(git -C "$repo" rev-parse --short HEAD)" "${PARITY_PR:-null}" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$out/build.json"
