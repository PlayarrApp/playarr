#!/usr/bin/env bash
# Reproduces the Tizen 6.5 engine run: the built Tizen web package (apps/tv-tizen/dist) in Chromium 85 (the Tizen 6.5 engine) with the Tizen 6.5
# user agent, against the static parity server (pinned clock from parity.env): screens in dark and light, then the D-pad checks, into <out>.
# No Tizen TV 6.5 emulator image exists, so the engine is a pinned Chromium 85 build on its own Xvfb display; it needs no emulator lock.
#   TIZEN65_OUT=<legend dir>/dev TIZEN65_CHROME=<chrome-linux dir> scripts/parity/tizen-webos/run-tizen65.sh [suite-run args]
# Setup, once per run (the page must be the built dist; the pointer is parked off the 1920x1080 page on the larger screen):
#   scripts/parity/tizen-webos/write-build-info.sh clients/tv-web/apps/tv-tizen/dist   # after `pnpm --filter @playarr-tv/app-tizen... run build`
#   (cd clients/tv-web/apps/tv-tizen/dist && python3 -m http.server 18565 --bind 127.0.0.1) &
#   Xvfb :65 -screen 0 2000x1200x24 -nolisten tcp &
#   DISPLAY=:65 $TIZEN65_CHROME/chrome --no-sandbox --user-data-dir=<profile> --remote-debugging-port=9285 --window-position=0,0 --window-size=1920,1080 \
#     --force-device-scale-factor=1 --disable-gpu --num-raster-threads=1 --disable-partial-raster --force-color-profile=srgb \
#     --user-agent="<Tizen 6.5 UA of clients/tv-web/web/scripts/tv-viewport.mjs>" --autoplay-policy=no-user-gesture-required --app=http://127.0.0.1:18565/
#   WEBOS_CDP=9285 WEBOS_MATCH='^http' node scripts/parity/tizen-webos/signin-webos.mjs      # once per profile
# Player controls cannot be captured: stock Chromium has no H.264, so the clip has no frames (the Tizen emulator plays it through AVPlay).
set -euo pipefail
here=$(cd "$(dirname "$0")/.." && pwd)
out=${TIZEN65_OUT:?set TIZEN65_OUT to the capture directory}
cd "$here"
eval "$(node parity-config.mjs --shell)"
export DEVICE=tizen65 PARITY_CLIENT=${PARITY_CLIENT:-tizen65} PARITY_LOCK_DIR=${PARITY_LOCK_DIR:-$out.lock}
mkdir -p "$PARITY_LOCK_DIR"
exec node suite-run.mjs --driver drivers/tizen-webos.mjs --out "$out" "$@" --only screens,dpad --skip-player
