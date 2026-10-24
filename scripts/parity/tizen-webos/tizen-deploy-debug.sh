#!/usr/bin/env bash
# Debug build of the Tizen web package for the suite driver: the clean dist plus netlog.js (host log sink and eval channel),
# signed with a Samsung certificate profile, installed on the Tizen TV emulator and launched.
#   TIZEN_STAGE=<scratch dir> [TIZEN_PROFILE=<profile>] [TIZEN_SERIAL=<sdb serial>] [TIZEN_CLI=<tizen>] tizen-deploy-debug.sh
# Run it only while holding the shared emulator lock (flock) and build first: pnpm --filter @playarr-tv/app-tizen... run build
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
dist=$here/../../../clients/tv-web/apps/tv-tizen/dist
stage=${TIZEN_STAGE:?set TIZEN_STAGE to a scratch directory}
profile=${TIZEN_PROFILE:-PlayarrSamsungTV}
serial=${TIZEN_SERIAL:-emulator-26101}
tizen=${TIZEN_CLI:-$HOME/tizen-studio/tools/ide/bin/tizen}
mkdir -p "$stage/app"
rsync -a --delete "$dist/" "$stage/app/"
cp "$here/netlog.js" "$stage/app/netlog.js"
sed -i 's#<head>#<head><script src="./netlog.js"></script>#' "$stage/app/index.html"
rm -f "$stage/Playarr.wgt"
"$tizen" package -t wgt -s "$profile" -- "$stage/app" | tail -1
mv "$stage/app/Playarr.wgt" "$stage/Playarr.wgt"
"$tizen" install -n Playarr.wgt -s "$serial" -- "$stage" | grep -E "install (failed|completed)|reason|Installed" || true
"$tizen" run -p StrmarrTV1.Playarr -s "$serial" | tail -1
