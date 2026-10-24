#!/usr/bin/env bash
# One command for the full native Tizen parity run (15 screens in dark and light, then the 12 D-pad checks) against the static
# parity server with the pinned clock, written into the legend dir. Needs: the Tizen TV emulator up and the debug tpk
# (`-p:PlayarrDebug=true`, see clients/tizen-native/scripts/deploy.sh) installed and signed in as the static `parity` account,
# and sdb on PATH or in PLAYARR_SDB. Holds the emulator lock shared with the tizen-webos lane.
#   scripts/parity/tizen-native/run.sh <out dir> [extra suite-run.mjs args]
# PARITY_LOCK_DIR (scratch dir for the account lock) and PARITY_EMULATOR_LOCK (flock file) must be set by the caller.
set -euo pipefail
out=${1:?usage: run.sh <out dir> [suite args]}; shift || true
here=$(cd "$(dirname "$0")/.." && pwd)
: "${PARITY_LOCK_DIR:?set PARITY_LOCK_DIR to a scratch directory}"
cd "$here"
eval "$(node parity-config.mjs --shell)"
export PARITY_CLIENT=tizen-native
run() { flock "${PARITY_EMULATOR_LOCK:-$PARITY_LOCK_DIR/emulator.lock}" node suite-run.mjs --driver ./drivers/tizen-native.mjs --out "$out" "$@"; }
run --only screens --extra-screens calendar-link "$@"
run --only dpad "$@"
