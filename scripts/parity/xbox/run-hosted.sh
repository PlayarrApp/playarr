#!/usr/bin/env bash
# run-hosted.sh <legend-dir> [ref]: the one command for a full Xbox parity run. Dispatches parity-xbox.yml (screens in both
# themes plus every D-pad check on the paused fixture, static server, pinned clock 2026-10-07T12:00:00Z), waits for exactly that
# run with gh-watcher, pulls its artifacts into <legend-dir>/dev as one complete set and scores the layout in both themes.
# Needs gh and gh-watcher. ref defaults to integration/parity; WORKFLOW_REF picks the branch the workflow file comes from (main).
set -euo pipefail
LEGEND=${1:?legend dir}; REF=${2:-integration/parity}
REPO=PlayarrApp/playarr
HERE=$(cd "$(dirname "$0")" && pwd)
BEFORE=$(date -u +%Y-%m-%dT%H:%M:%SZ)
gh workflow run parity-xbox.yml -R "$REPO" --ref "${WORKFLOW_REF:-main}" -f "ref=$REF"
RUN=""
for _ in 1 2 3 4 5 6; do
  sleep 10
  RUN=$(gh run list -R "$REPO" -w parity-xbox.yml -e workflow_dispatch --json databaseId,createdAt -q "[.[]|select(.createdAt>=\"$BEFORE\")]|sort_by(.createdAt)|.[0].databaseId // empty")
  [ -n "$RUN" ] && break
done
[ -n "$RUN" ] || { echo "dispatched run not found" >&2; exit 1; }
echo "run $RUN"
gh-watcher wait --repo "$REPO" --run "$RUN" --timeout 150m --json > "$LEGEND/.run-$RUN.json"
grep -q '"state": "success"' "$LEGEND/.run-$RUN.json" || { echo "run $RUN did not succeed" >&2; cat "$LEGEND/.run-$RUN.json" >&2; exit 1; }
"$HERE/../../xbox-wall/pull-captures.sh" "$RUN" "$LEGEND"
# Layout score (docs/parity/LAYOUT.md), both themes, against the web layout refs of the same legend dir.
for T in dark light; do
  for f in "$LEGEND"/dev/layout/"$T"/*.json; do
    [ -e "$f" ] || continue
    S=$(basename "${f%.json}"); REF_JSON="$LEGEND/web/layout/$T/$S.json"
    [ -e "$REF_JSON" ] && node "$HERE/../layout-score.mjs" --ref "$REF_JSON" --device "$f" | head -1
  done
done
