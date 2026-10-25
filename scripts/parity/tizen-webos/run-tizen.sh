#!/usr/bin/env bash
# Reproduces the Samsung Tizen emulator run (web package, debug build with netlog.js) against the static parity server:
# screens in dark and light, then the D-pad checks, into <out>. Extra arguments go to suite-run.mjs.
#   TIZEN_OUT=<legend dir>/tizen PARITY_NETLOG=<dir> TIZEN_LOCK=<shared emulator lock file> scripts/parity/tizen-webos/run-tizen.sh
# Needs the emulator on TIZEN_DISPLAY (default :27) with the debug build installed (tizen-deploy-debug.sh), the log sink
# (`python3 scripts/parity/tizen-webos/logserver.py <PARITY_NETLOG>/log.txt`) and the sign-in (signin-tizen.mjs).
# The web run uses its own emulator instance (serial TIZEN_SERIAL, default emulator-26111, display :27). If one emulator is
# shared with another run, set TIZEN_LOCK: the script then holds that flock for the whole run. It brings the web app to
# the foreground and waits until it answers with the parity session before the first capture.
# Signing (tizen-deploy-debug.sh) reads the certificate password from ~/.secrets at run time; nothing is written to profiles.xml.
set -euo pipefail
out=${TIZEN_OUT:?set TIZEN_OUT to the capture directory}
: "${PARITY_NETLOG:?set PARITY_NETLOG to the log sink directory}"
if [ -n "${TIZEN_LOCK:-}" ] && [ -z "${TIZEN_LOCKED:-}" ]; then
  exec env TIZEN_LOCKED=1 flock -w "${TIZEN_LOCK_WAIT:-7200}" "$TIZEN_LOCK" "$0" "$@"
fi
here=$(cd "$(dirname "$0")/.." && pwd)
cd "$here"
eval "$(node parity-config.mjs --shell)"
export TIZEN_DISPLAY=${TIZEN_DISPLAY:-:27}
export DEVICE=tizen PARITY_CLIENT=${PARITY_CLIENT:-tizen} PARITY_LOCK_DIR=${PARITY_LOCK_DIR:-$out.lock}
mkdir -p "$PARITY_LOCK_DIR"
tizen=${TIZEN_CLI:-$HOME/tizen-studio/tools/ide/bin/tizen}
for attempt in 1 2 3 4; do
  "$tizen" run -p StrmarrTV1.Playarr -s "${TIZEN_SERIAL:-emulator-26111}" >/dev/null || true
  sleep 15
  if node tizen-webos/verify-tizen-session.mjs; then ok=1; break; fi
done
[ -n "${ok:-}" ] || { echo "Tizen web app did not answer with the parity session" >&2; exit 1; }
exec node suite-run.mjs --driver drivers/tizen-webos.mjs --out "$out" "$@" --only screens,dpad --skip-player
