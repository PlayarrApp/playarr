#!/bin/bash
# Shared launcher for the old-Chromium stand-ins of the TV web engines (Tizen 6.5 = Chromium 85, webOS = Chromium 94),
# in their own cgroup, on the virtual display the parity run grabs (xwd).
#   CHROME_BIN=<chromium binary> PROFILE_DIR=<profile dir> URL=<dist server> DISPLAY=:65 ./launch-chromium.sh
#   Optional: UA (default: the Tizen 6.5 TV user agent, which has no Chrome/ token, the app keys its legacy path on that;
#   webOS callers pass their own), CDP_PORT (default 9285), SIZE (default 1920,1080), EXTRA, UNIT (systemd scope name).
# Raster mode: CPU (software) raster, like the web references (Chromium 151 on software raster), and deterministic across
# twin runs. RASTER=gpu selects GPU raster on SwiftShader instead; it is NOT the default because there is no evidence yet
# that real Tizen 6.5 / webOS TVs rasterise on the GPU (docs/parity/DEVICES.md, "Chromium stand-in raster mode").
set -euo pipefail
: "${CHROME_BIN:?set CHROME_BIN to the Chromium 85 binary}"
: "${PROFILE_DIR:?set PROFILE_DIR}"
: "${DISPLAY:?set DISPLAY to the virtual display}"
UA="${UA:-Mozilla/5.0 (SMART-TV; Linux; Tizen 6.5) AppleWebKit/537.36 (KHTML, like Gecko) 85.0.4183.93/6.5 TV Safari/537.36}"
if [ "${RASTER:-software}" = "gpu" ]; then
  RASTER_FLAGS=(--use-gl=swiftshader --ignore-gpu-blocklist --enable-gpu-rasterization --disable-partial-raster)
else
  RASTER_FLAGS=(--disable-gpu --num-raster-threads=1 --disable-partial-raster)
fi
exec systemd-run --user --scope -q --unit="${UNIT:-playarr-tizen65-chrome}" -p MemoryHigh=8G -p MemoryMax=12G -p MemorySwapMax=512M \
  "$CHROME_BIN" --no-sandbox "${RASTER_FLAGS[@]}" --force-color-profile=srgb --user-data-dir="$PROFILE_DIR" \
  --no-first-run --no-default-browser-check --remote-debugging-port="${CDP_PORT:-9285}" --window-position=0,0 \
  --window-size="${SIZE:-1920,1080}" --force-device-scale-factor=1 --user-agent="$UA" \
  --autoplay-policy=no-user-gesture-required ${EXTRA:-} --app="${URL:?set URL}"
