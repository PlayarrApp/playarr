#!/usr/bin/env bash
# Builds the webOS package from this checkout, copies it into the simulator's app folder and restarts the simulator unit.
#   WEBOS_STAGE=<app folder the simulator launches> [WEBOS_UNIT=playarr-slot6-webos.service] scripts/parity/tizen-webos/deploy-webos.sh
# The simulator keeps its sign-in (localStorage) across restarts.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
tv=$here/../../../clients/tv-web
stage=${WEBOS_STAGE:?set WEBOS_STAGE to the simulator app folder}
(cd "$tv" && pnpm --filter @playarr-tv/app-webos... run build >/dev/null)
rsync -a --delete "$tv/apps/tv-webos/dist/" "$stage/"
systemctl --user restart "${WEBOS_UNIT:-playarr-slot6-webos.service}"
for _ in $(seq 60); do curl -fs "http://127.0.0.1:${WEBOS_CDP:-9226}/json/list" | grep -q webos-stage && exit 0; sleep 1; done
echo "simulator did not come up" >&2; exit 1
