#!/usr/bin/env bash
# Publish a finished run into the legend dir: android-tv/publish.sh <run-dir> <branch> <pr-number|null>
# Deletes the previous captures (PNG, including old bak* capture folders) of the candidate, keeps every JSON result, copies the new
# captures and JSON in and writes build.json. PARITY_LEGEND_DIR is the legend root (the `<dir>` of the device is `android`, cand `dev`).
set -euo pipefail
run=$1 branch=$2 pr=${3:-null}
dest=${PARITY_LEGEND_DIR:?set PARITY_LEGEND_DIR}/android/dev
mkdir -p "$dest"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
for d in "$dest"/dark "$dest"/light "$dest"/layout; do [ -d "$d" ] && rm -r "$d"; done
for f in "$dest"/*.png; do [ -e "$f" ] && rm "$f"; done
for d in "$dest"/../dev.bak*; do [ -d "$d" ] && find "$d" -type f \( -name "*.png" -o -name "*.jpg" -o -name "*.mp4" -o -name "*.gif" \) -delete; done
# Every JSON result stays: the previous ones are kept under a timestamp, the new ones take the plain names.
for j in captures readiness dpad; do [ -e "$dest/$j.json" ] && mv "$dest/$j.json" "$dest/$j.$stamp.json"; done
cp -r "$run"/dark "$run"/light "$dest"/
[ -d "$run"/layout ] && cp -r "$run"/layout "$dest"/ || { echo "run has no layout/ directory" >&2; exit 1; }
for j in "$run"/*.json; do [ -e "$j" ] && cp "$j" "$dest"/; done
sha=$(git rev-parse HEAD)
printf '{ "branch": "%s", "sha": "%s", "pr": %s, "captured_at": "%s", "server": "static server" }\n' "$branch" "$sha" "$pr" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$dest/build.json"
