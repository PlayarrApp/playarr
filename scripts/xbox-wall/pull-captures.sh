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
cat "$DEST/dev/build.json"
