#!/usr/bin/env bash
# One command for the hosted Apple parity run: dispatch parity-apple.yml for tvos or macos, wait for it, download the
# artifacts and copy them into the legend directory (screens in both themes, D-pad, build.json).
#   scripts/parity/apple/run.sh <tvos|macos> [app-ref] [workflow-ref]
# app-ref: branch or SHA of the apps to build (default: the current branch). workflow-ref: the branch whose workflow
# and scripts run (default: the same, so driver changes are exercised before they reach main).
# Needs: gh (authenticated), LEGEND_ROOT (the parity legend directory root). Static server, pinned clock: set by the workflow.
set -euo pipefail
device=${1:?usage: run.sh <tvos|macos> [app-ref] [workflow-ref]}
ref=${2:-$(git rev-parse --abbrev-ref HEAD)}
wfref=${3:-$ref}
root=${LEGEND_ROOT:?set LEGEND_ROOT to the legend directory root}
case $device in
  tvos) dest=$root/apple/tvos; extra=() ;;
  macos) dest=$root/macos/dev; extra=(-f "suite_args=--only screens,dpad") ;;
  *) echo "device must be tvos or macos" >&2; exit 2 ;;
esac
repo=PlayarrApp/playarr
if [[ -z ${RUN_ID:-} ]]; then gh workflow run parity-apple.yml -R "$repo" --ref "$wfref" -f devices="$device" -f ref="$ref" -f stream=false -f chain=false "${extra[@]}"; sleep 20; fi # RUN_ID=<id> resumes a run already dispatched
id=$(gh run list -R "$repo" -w parity-apple.yml -L 10 --json databaseId,displayTitle -q "[.[]|select(.displayTitle|contains(\"[$device]\"))][0].databaseId")
id=${RUN_ID:-$id}
echo "run $id"
gh run watch "$id" -R "$repo" --exit-status || true
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
gh run download "$id" -R "$repo" -D "$tmp"
mkdir -p "$dest/light"
for d in "$tmp"/apple-wall-"$device"-dark-*; do cp "$d"/dark/*.png "$dest/"; cp "$d"/dpad.json "$dest/dpad.json"; [[ ! -d $d/layout ]] || { mkdir -p "$dest/layout"; cp -r "$d"/layout/. "$dest/layout/"; }; done
for d in "$tmp"/apple-wall-"$device"-light-*; do cp "$d"/light/*.png "$dest/light/"; [[ ! -d $d/layout ]] || { mkdir -p "$dest/layout"; cp -r "$d"/layout/. "$dest/layout/"; }; done
printf '{"branch":"%s","sha":"%s","pr":null,"captured_at":"%s","server":"static server","run":"%s"}\n' \
  "$ref" "$(git rev-parse HEAD)" "$(date -u +%FT%TZ)" "$id" > "$dest/build.json"
echo "captures in $dest"
