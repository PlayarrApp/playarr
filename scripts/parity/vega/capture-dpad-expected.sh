#!/usr/bin/env bash
# Recaptures the Fire TV (Vega) player D-pad web reference into expected.firetv.static.json.
# The Fire TV layout reference is captured with the xbox user agent (Mute, Volume and Fullscreen are in the control row), so the player
# D-pad reference uses the same user agent, and the server negotiates the audio track for Vega's own capability profile
# (clients/fire-tv/src/lib/playbackCapabilities.ts), so the audio label comes from the same negotiation as on the device.
# Only the player-* D-pad entries differ from expected.static.json; every other entry is copied unchanged.
#   scripts/parity/vega/capture-dpad-expected.sh <out-dir>     (needs the static parity server and its environment, as for capture-refs.mjs)
set -euo pipefail
out=${1:?usage: capture-dpad-expected.sh <out-dir>}
here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$here"
eval "$(node parity-config.mjs --shell)"
export PLAYARR_WEB_USER_AGENT="Mozilla/5.0 (Windows NT 10.0; Win64; x64; Xbox; Xbox One) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edge/44.18363.8131"
export PLAYARR_WEB_PLAYBACK_QUERY='{"containers":"mp4,m4v,mov,mkv,ts,mp3,m4a,flac","video_codecs":"h264,hevc","audio_codecs":"aac,eac3,ac3,mp3,flac,opus,pcm_s16le,pcm_s24le","hdr":"hdr10,hlg","max_bit_depth":10,"video_profiles":"hevc:main 10","max_width":3840,"max_height":2160,"max_fps":60,"max_bitrate_bps":25000000,"max_channels":6,"passthrough":"eac3,ac3"}'
checks=player-initial-focus,player-right,player-right-3,player-right-end,player-left-edge,player-up-seek,player-up-down,player-ok-toggle,player-panel-open,player-panel-close,player-back,player-back-back
mkdir -p "$out"
node suite-run.mjs --driver ./drivers/web.mjs --player --reference --only dpad --checks "$checks" --out "$out"
node -e '
const fs = require("fs");
const base = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const fresh = JSON.parse(fs.readFileSync(process.argv[2] + "/expected.json", "utf8"));
for (const id of process.argv[3].split(",")) if (fresh.dpad?.[id] !== undefined) base.dpad[id] = fresh.dpad[id];
base.note += " Fire TV player D-pad entries (player-*) are recaptured with the xbox user agent and the Vega capability profile (vega/capture-dpad-expected.sh).";
fs.writeFileSync(process.argv[4], JSON.stringify(base, null, 2) + "\n");
' expected.static.json "$out" "$checks" expected.firetv.static.json
