#!/usr/bin/env bash
# pull-captures.sh <run-id> <legend-dir>: download one Xbox wall run's artifacts (screens dark/light, dpad, playback) into the legend
# folder as dev/<id>.png, dev/light/<id>.png, dev/dpad.json, dev/playback.json and dev/build.json. Needs an authenticated gh.
set -euo pipefail
RUN=${1:?run id}; DEST=${2:?legend dir}
mkdir -p "$DEST/dev"
for part in screens-dark screens-light dpad playback; do
  # One folder per part: every artifact carries its own build.json, and gh refuses to overwrite a file.
  gh run download "$RUN" -R PlayarrApp/playarr -n "xbox-wall-$part-$RUN" -D "$DEST/dev/.part-$part" || { echo "missing $part" >&2; continue; }
  cp -R "$DEST/dev/.part-$part/." "$DEST/dev/"
  rm -rf "$DEST/dev/.part-$part"
done
# Layout-score exports (<theme>/<screen>.layout.json) ride in the debug artifact until the workflow copies them into dev/layout.
for part in screens-dark screens-light; do
  T=${part#screens-}
  T_DIR="$DEST/dev/.debug-$part"
  gh run download "$RUN" -R PlayarrApp/playarr -n "xbox-wall-debug-$part" -D "$T_DIR" 2>/dev/null || { echo "no debug artifact for $part" >&2; continue; }
  mkdir -p "$DEST/dev/layout/$T"
  for f in "$T_DIR"/run/"$T"/*.layout.json; do [ -e "$f" ] && cp "$f" "$DEST/dev/layout/$T/$(basename "${f%.layout.json}").json"; done
  rm -rf "$T_DIR"
done
cat "$DEST/dev/build.json"
