#!/usr/bin/env bash
# pull-captures.sh <run-id> <legend-dir>: download one Xbox wall run's artifacts as ONE complete set into <legend-dir>/dev
# (dev/<id>.png, dev/light/<id>.png, dev/layout/<theme>/<id>.json, dev/dpad.json, dev/build.json). Fails when any artifact is
# missing (every screenshot must have its layout file); the old dev folder is replaced only after every part arrived. Needs an authenticated gh.
set -euo pipefail
RUN=${1:?run id}; DEST=${2:?legend dir}
TMP="$DEST/.dev-new-$RUN"
rm -rf "$TMP"; mkdir -p "$TMP/layout/dark" "$TMP/layout/light"
for part in screens-dark screens-light dpad; do
  # One folder per part: every artifact carries its own build.json, and gh refuses to overwrite a file.
  gh run download "$RUN" -R PlayarrApp/playarr -n "xbox-wall-$part-$RUN" -D "$TMP/.part-$part"
  cp -R "$TMP/.part-$part/." "$TMP/"
  [ "$part" = screens-dark ] && cp "$TMP/.part-$part/build.json" "$TMP/build.json"
  rm -rf "$TMP/.part-$part"
done
# Layout exports ride in the debug artifact (the workflow's dev artifact carries the PNGs and results).
for T in dark light; do
  gh run download "$RUN" -R PlayarrApp/playarr -n "xbox-wall-debug-screens-$T" -D "$TMP/.debug-$T"
  for f in "$TMP/.debug-$T/run/$T"/*.layout.json; do cp "$f" "$TMP/layout/$T/$(basename "${f%.layout.json}").json"; done
  rm -rf "$TMP/.debug-$T"
done
[ -e "$TMP/dpad.json" ] && [ -e "$TMP/home.png" ] && [ -e "$TMP/light/home.png" ] || { echo "incomplete download" >&2; exit 1; }
# Every screenshot needs its layout export (same frame, see the driver): a missing one fails the pull.
for T in dark light; do
  if [ "$T" = dark ]; then SHOTS="$TMP"; else SHOTS="$TMP/light"; fi
  for png in "$SHOTS"/*.png; do
    [ -e "$TMP/layout/$T/$(basename "${png%.png}").json" ] || { echo "missing layout: $T/$(basename "${png%.png}")" >&2; exit 1; }
  done
done
mkdir -p "$DEST/dev"
find "$DEST/dev" -mindepth 1 -maxdepth 1 \( -name '*.png' -o -name layout -o -name light \) -exec rm -rf {} +
cp -R "$TMP/." "$DEST/dev/"
rm -rf "$TMP"
cat "$DEST/dev/build.json"
