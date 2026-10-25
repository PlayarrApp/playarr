#!/usr/bin/env bash
# Publish a finished Vega run into the legend dir: vega/publish.sh <run-dir> <branch> <pr-number|null>
# PARITY_LEGEND_DIR is the legend root (the device's `<dir>` is `firetv`, candidate `dev`). Deletes the previous candidate captures
# (PNGs and the older tv/ layout), keeps every JSON result under a timestamp, copies the new captures, layout documents and JSON in
# and writes build.json. Afterwards run the shared archive and cleanup scripts (BRIEF.md).
set -euo pipefail
run=$1 branch=$2 pr=${3:-null}
dest=${PARITY_LEGEND_DIR:?set PARITY_LEGEND_DIR}/firetv/dev
mkdir -p "$dest"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
for d in "$dest"/dark "$dest"/light "$dest"/layout "$dest"/tv; do [ -d "$d" ] && rm -r "$d"; done
for f in "$dest"/*.png; do [ -e "$f" ] && rm "$f"; done
for j in captures readiness dpad; do [ -e "$dest/$j.json" ] && mv "$dest/$j.json" "$dest/$j.$stamp.json"; done
for part in dark light layout; do [ -d "$run/$part" ] && cp -r "$run/$part" "$dest/"; done
for j in "$run"/*.json; do [ -e "$j" ] && cp "$j" "$dest"/; done
sha=$(git rev-parse --short HEAD)
printf '{ "branch": "%s", "sha": "%s", "pr": %s, "captured_at": "%s", "server": "static server" }\n' "$branch" "$sha" "$pr" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$dest/build.json"
