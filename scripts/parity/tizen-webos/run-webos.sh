#!/usr/bin/env bash
# Reproduces the LG webOS Simulator run against the static parity server (pinned clock 2026-10-07T12:00:00Z from parity.env):
# screens in dark and light, then the D-pad checks, into <out>. Extra arguments go to suite-run.mjs (for example --screens home,movies --only screens).
#   WEBOS_OUT=<legend dir>/webos scripts/parity/tizen-webos/run-webos.sh
# Needs the simulator on WEBOS_DISPLAY (default :26) with the inspector on WEBOS_CDP (default 9226), signed in to the static server as the parity account
# (`signin-webos.mjs`), and PARITY_LOCK_DIR (default: a directory next to <out>). The password comes from ~/.secrets and is never printed.
set -euo pipefail
here=$(cd "$(dirname "$0")/.." && pwd)
out=${WEBOS_OUT:?set WEBOS_OUT to the capture directory}
cd "$here"
eval "$(node parity-config.mjs --shell)"
export DEVICE=webos PARITY_CLIENT=${PARITY_CLIENT:-webos} PARITY_LOCK_DIR=${PARITY_LOCK_DIR:-$out.lock}
mkdir -p "$PARITY_LOCK_DIR"
exec node suite-run.mjs --driver drivers/tizen-webos.mjs --out "$out" --only screens,dpad --skip-player "$@"
