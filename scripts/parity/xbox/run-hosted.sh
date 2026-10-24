#!/usr/bin/env bash
# run-hosted.sh <legend-dir> [ref]: the one command for a full Xbox parity run. Dispatches parity-xbox.yml (screens in both
# themes plus the D-pad checks, static server, pinned clock 2026-10-07T12:00:00Z), waits for it and pulls the artifacts into
# <legend-dir>/dev (see scripts/xbox-wall/pull-captures.sh). Needs an authenticated gh. ref defaults to integration/parity.
set -euo pipefail
LEGEND=${1:?legend dir}; REF=${2:-integration/parity}
REPO=PlayarrApp/playarr
# Workflow files come from main; set WORKFLOW_REF to a branch to run a workflow change before it reaches main.
gh workflow run parity-xbox.yml -R "$REPO" --ref "${WORKFLOW_REF:-main}" -f "ref=$REF"
sleep 20
RUN=$(gh run list -R "$REPO" -w parity-xbox.yml -L 1 --json databaseId -q '.[0].databaseId')
gh run watch "$RUN" -R "$REPO" --exit-status --interval 60 >/dev/null
"$(dirname "$0")/../../xbox-wall/pull-captures.sh" "$RUN" "$LEGEND"
# Layout score (docs/parity/LAYOUT.md), both themes: dev/layout/<theme>/<screen>.json against the web layout refs of the same legend dir.
HERE=$(cd "$(dirname "$0")" && pwd)
for T in dark light; do
  for f in "$LEGEND"/dev/layout/"$T"/*.json; do
    [ -e "$f" ] || continue
    S=$(basename "${f%.json}"); REF="$LEGEND/web/layout/$T/$S.json"
    [ -e "$REF" ] && node "$HERE/../layout-score.mjs" --ref "$REF" --device "$f" | head -1
  done
done
