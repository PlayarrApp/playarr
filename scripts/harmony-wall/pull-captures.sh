#!/usr/bin/env bash
# pull-captures.sh <run-id> <tv|phone> <legend-dir>: download one Harmony wall run's captures into the legend folder
# (dark screens as dev/<id>.png, light as dev/light/<id>.png, plus build.json). Needs an authenticated gh. Never run on a failed run.
set -euo pipefail
RUN=${1:?run id}; DEVICE=${2:?tv or phone}; DEST=${3:?legend dir}
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
gh run download "$RUN" -R ThomasMcFarlane/playarr -n "harmony-wall-$DEVICE-$RUN" -D "$TMP"
mkdir -p "$DEST/dev/light"
for f in "$TMP"/dark/*.png; do cp "$f" "$DEST/dev/$(basename "$f")"; done
for f in "$TMP"/light/*.png; do cp "$f" "$DEST/dev/light/$(basename "$f")"; done
cp "$TMP/build.json" "$DEST/dev/build.json"
cat "$DEST/dev/build.json"
