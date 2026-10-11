#!/usr/bin/env bash
# pull-captures.sh <run-id> <legend-dir>: download one Xbox wall run's artifacts (screens dark/light, dpad, playback) into the legend
# folder as dev/<id>.png, dev/light/<id>.png, dev/dpad.json, dev/playback.json and dev/build.json. Needs an authenticated gh.
set -euo pipefail
RUN=${1:?run id}; DEST=${2:?legend dir}
mkdir -p "$DEST/dev"
for part in screens-dark screens-light dpad playback; do
  gh run download "$RUN" -R ThomasMcFarlane/playarr -n "xbox-wall-$part-$RUN" -D "$DEST/dev" || echo "missing $part" >&2
done
cat "$DEST/dev/build.json"
