#!/usr/bin/env bash
# Reproduces the Samsung Tizen emulator run (web package, debug build with netlog.js) against the static parity server:
# screens in dark and light, then the D-pad checks, into <out>. Extra arguments go to suite-run.mjs.
#   TIZEN_OUT=<legend dir>/tizen PARITY_NETLOG=<dir> scripts/parity/tizen-webos/run-tizen.sh
# Needs the emulator on TIZEN_DISPLAY (default :25) with the debug build installed (tizen-deploy-debug.sh), the log sink
# (`python3 scripts/parity/tizen-webos/logserver.py <PARITY_NETLOG>/log.txt`) and the sign-in (signin-tizen.mjs).
# The emulator is shared with the native Tizen run: hold its lock (flock) for the whole run.
set -euo pipefail
here=$(cd "$(dirname "$0")/.." && pwd)
out=${TIZEN_OUT:?set TIZEN_OUT to the capture directory}
: "${PARITY_NETLOG:?set PARITY_NETLOG to the log sink directory}"
cd "$here"
eval "$(node parity-config.mjs --shell)"
export DEVICE=tizen PARITY_CLIENT=${PARITY_CLIENT:-tizen} PARITY_LOCK_DIR=${PARITY_LOCK_DIR:-$out.lock}
mkdir -p "$PARITY_LOCK_DIR"
# The native Tizen run uses the same emulator: bring this app to the foreground (it keeps its sign-in) and let it start the netlog poll.
"${TIZEN_CLI:-$HOME/tizen-studio/tools/ide/bin/tizen}" run -p StrmarrTV1.Playarr -s "${TIZEN_SERIAL:-emulator-26101}" >/dev/null
sleep 15
exec node suite-run.mjs --driver drivers/tizen-webos.mjs --out "$out" "$@" --only screens,dpad --skip-player
