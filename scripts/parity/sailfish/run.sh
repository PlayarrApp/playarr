#!/usr/bin/env bash
# One command for the full Sailfish parity run (all screens, dark and light) on the headless SDK emulator against the
# static parity server, with the pinned capture clock. Writes to PLAYARR_SF_OUT. D-pad is not run: touch device.
# usage: run.sh [extra suite-run args, e.g. --screens home,movies]
# env:   PLAYARR_SF_SSH_KEY (emulator key), optional PLAYARR_SF_SSH_CONFIG, PLAYARR_SF_SCRATCH (scratch dir), PLAYARR_SF_VBOXMANAGE and VBOX_USER_HOME
#        (VirtualBox install and home), PLAYARR_SF_OUT (the legend capture dir), PARITY_CLIENT=sailfish and PARITY_LOCK_DIR
#        (scratch lock dir), PLAYARR_SF_SKIP_SIGNIN=1 to keep the session.
set -euo pipefail
H=$(cd -- "$(dirname -- "$0")" && pwd)
: "${PLAYARR_SF_SSH_KEY:?}" "${PLAYARR_SF_SCRATCH:?}" "${PLAYARR_SF_OUT:?}" "${PARITY_CLIENT:?}" "${PARITY_LOCK_DIR:?}"
OUT=$PLAYARR_SF_OUT
"$H/vm-coldboot.sh"
[ "${PLAYARR_SF_SKIP_SIGNIN:-}" = 1 ] || node "$H/sign-in.mjs"
set -a; eval "$(node "$H/../parity-config.mjs" --shell)"; set +a
export PLAYARR_DEVICE_TEST_USERNAME=${PARITY_ACCOUNT_NAME}
# Static direct-play fixture used for the player-controls capture.
export PLAYARR_SF_PLAYER_FILE=${PLAYARR_SF_PLAYER_FILE:-5536650d-01d2-5220-a279-af277fe82726}
exec node "$H/../suite-run.mjs" --driver "$H/driver.mjs" --out "$OUT" --only screens --via route --extra-screens calendar-link "$@"
