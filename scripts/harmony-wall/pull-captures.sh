#!/usr/bin/env bash
# pull-captures.sh <run-id> <tv|phone> <legend-dir>: download one Harmony wall run's captures into the legend folder
# (dark screens as dev/<id>.png, light as dev/light/<id>.png, plus build.json). Needs an authenticated gh. Never run on a failed run.
set -euo pipefail
RUN=${1:?run id}; DEVICE=${2:?tv or phone}; DEST=${3:?legend dir}
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
# the phone's themes are separate artifacts (harmony-wall-phone-<run>-dark / -light); the TV's is one
gh run download "$RUN" -R PlayarrApp/playarr -p "harmony-wall-$DEVICE-$RUN*" -D "$TMP"
mkdir -p "$DEST/dev/light"
# the artifact root is the common parent of its files, so it may or may not hold a capture/ level: find the folders
for d in $(find "$TMP" -type d -name dark -o -type d -name light | grep -v -e _debug -e "/layout/" -e "/layout-raw/" -e "/layout-probe/"); do
  case $(basename "$d") in
    dark) for f in "$d"/*.png; do cp "$f" "$DEST/dev/$(basename "$f")"; done ;;
    light) for f in "$d"/*.png; do cp "$f" "$DEST/dev/light/$(basename "$f")"; done ;;
  esac
done
for L in $(find "$TMP" -type d -name layout | grep -v _debug); do mkdir -p "$DEST/dev/layout"; cp -r "$L/." "$DEST/dev/layout/"; done  # one per theme job on the phone
D=$(find "$TMP" -name dpad.json | head -1); [ -z "$D" ] || cp "$D" "$DEST/dev/dpad.json"
cp "$(find "$TMP" -name build.json | sort | head -1)" "$DEST/dev/build.json"
cat "$DEST/dev/build.json"
for L in $(find "$TMP" -type d -name layout-raw); do mkdir -p "$DEST/layout-raw"; cp -r "$L/." "$DEST/layout-raw/"; done  # kept beside dev/, not in the legend cand dir
