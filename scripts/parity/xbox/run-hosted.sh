#!/usr/bin/env bash
# run-hosted.sh <legend-dir> [ref]: the one command for a full Xbox parity run. Dispatches parity-xbox.yml (screens in both
# themes plus the D-pad checks, static server, pinned clock 2026-10-07T12:00:00Z), waits for it and pulls the artifacts into
# <legend-dir>/dev (see scripts/xbox-wall/pull-captures.sh). Needs an authenticated gh. ref defaults to integration/parity.
set -euo pipefail
LEGEND=${1:?legend dir}; REF=${2:-integration/parity}
REPO=PlayarrApp/playarr
gh workflow run parity-xbox.yml -R "$REPO" --ref main -f "ref=$REF"
sleep 20
RUN=$(gh run list -R "$REPO" -w parity-xbox.yml -L 1 --json databaseId -q '.[0].databaseId')
gh run watch "$RUN" -R "$REPO" --exit-status --interval 60 >/dev/null
"$(dirname "$0")/../../xbox-wall/pull-captures.sh" "$RUN" "$LEGEND"
