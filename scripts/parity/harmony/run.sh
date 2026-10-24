#!/usr/bin/env bash
# One command for the full HarmonyOS parity run (TV screens and phone, dark and light) against the static parity server:
#   scripts/parity/harmony/run.sh <branch> <legend-root>
# Dispatches parity-harmony.yml on the branch (hosted runners, public static server, pinned clock 2026-10-07T12:00:00Z), waits,
# and pulls the captures into <legend-root>/harmony and <legend-root>/harmony-phone. The legend service scores them.
# TV D-pad is excluded by owner decision (dpadNA), so only screens run. Needs an authenticated gh.
set -euo pipefail
BRANCH=${1:?branch}; ROOT=${2:?legend root}; HERE=$(cd "$(dirname "$0")" && pwd)
R=PlayarrApp/playarr
dispatch() { # dispatch <gh -f args...>: print the new run id
  gh workflow run parity-harmony.yml -R "$R" --ref "$BRANCH" "$@" >/dev/null; sleep 8
  gh run list -R "$R" -w parity-harmony.yml -b "$BRANCH" -L 1 --json databaseId --jq '.[0].databaseId'
}
TV=$(dispatch -f device=tv -f parts=screens)
PH=$(dispatch -f device=phone -f phone_core_only=true -f skip_player=true)
for id in "$TV" "$PH"; do gh-watcher wait --repo "$R" --run "$id" --timeout 120m --json | grep -q '"state": "success"' || { echo "run $id failed" >&2; exit 1; }; done  # one waiter per run, no polling loops
bash "$HERE/../../harmony-wall/pull-captures.sh" "$TV" tv "$ROOT/harmony"
bash "$HERE/../../harmony-wall/pull-captures.sh" "$PH" phone "$ROOT/harmony-phone"
