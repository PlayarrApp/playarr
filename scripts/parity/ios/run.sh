#!/usr/bin/env bash
# One command for the iPhone and iPad parity run: dispatch the hosted workflow for the pushed commit, wait, pull the
# artifacts, publish them into the legend dir and print the layout score per screen.
#   PARITY_LEGEND_ROOT=<legend root> scripts/parity/ios/run.sh [devices (iphone,ipad)] [screens (default all)]
# Needs gh (authenticated), gh-watcher, node and a checked out, pushed branch. Static server, pinned clock (workflow default).
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd); repo=$(git -C "$here" rev-parse --show-toplevel)
root=${PARITY_LEGEND_ROOT:?set PARITY_LEGEND_ROOT to the legend root}
devices=${1:-iphone,ipad}; screens=${2:-}
sha=$(git -C "$repo" rev-parse HEAD); branch=$(git -C "$repo" branch --show-current)
work=$(mktemp -d "${TMPDIR:-/tmp}/ios-parity.XXXXXX")
declare -A dir=([iphone]=ios-phone [ipad]=ios-tablet) ids
for d in ${devices//,/ }; do
  gh workflow run parity-apple-ios.yml --ref "$branch" -f devices="$d" -f ref="$sha" ${screens:+-f screens="$screens"} >/dev/null
  sleep 15
  ids[$d]=$(gh run list --workflow parity-apple-ios.yml --branch "$branch" --limit 10 --json databaseId,displayTitle,headSha,createdAt \
    -q "[.[]|select(.displayTitle|contains(\"[$d]\"))]|sort_by(.createdAt)|last|.databaseId")
done
for d in ${devices//,/ }; do
  gh-watcher wait --run "${ids[$d]}" --timeout 4h --json >"$work/$d.wait.json" || { echo "run ${ids[$d]} ($d) failed" >&2; exit 1; }
  for t in dark light; do gh run download "${ids[$d]}" -n "apple-wall-$d-${ids[$d]}-$t" -D "$work/$d-$t"; done
  c="$root/${dir[$d]}/dev"; mkdir -p "$c/light"
  cp "$work/$d-dark/dark/"*.png "$c/"; cp "$work/$d-light/light/"*.png "$c/light/"
  for t in dark light; do [ -d "$work/$d-$t/layout/$t" ] && { mkdir -p "$c/layout/$t"; cp "$work/$d-$t/layout/$t/"*.json "$c/layout/$t/"; }; done
  printf '{"branch":"%s","sha":"%s","pr":502,"captured_at":"%s","runner":"github-hosted","server":"static server","run":%s}\n' "$branch" "$sha" "$(date -u +%FT%TZ)" "${ids[$d]}" | tee "$c/build.json" >"$c/light/build.json"
  for t in dark light; do for f in "$c/layout/$t/"*.json; do s=$(basename "$f" .json)
    printf '%s %s %s: ' "${dir[$d]}" "$t" "$s"
    node "$repo/scripts/parity/layout-score.mjs" --ref "$root/${dir[$d]}/web/layout/$t/$s.json" --device "$f" 2>&1 | head -1
  done; done
done
rm -rf "$work"
