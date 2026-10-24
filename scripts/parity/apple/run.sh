#!/usr/bin/env bash
# One command for the hosted Apple parity run: dispatch parity-apple.yml for tvos or macos, wait for it, download the
# artifacts and copy them into the legend directory (screens in both themes, layout JSON, D-pad, build.json).
#   scripts/parity/apple/run.sh <tvos|macos> [app-ref] [workflow-ref]
# app-ref: branch or SHA of the apps to build (default: the current branch). workflow-ref: the branch whose workflow
# and scripts run (default: the same, so driver changes are exercised before they reach main).
# macOS runs two jobs: the screens (window hidden) and the D-pad checks in the visible-window mode the workflow reserves for
# them (a hidden window drops the arrow keys that leave Home and Back). Needs: gh (authenticated), LEGEND_ROOT (the legend
# directory root). Static server, pinned clock: set by the workflow. RUN_ID=<id> [DPAD_RUN_ID=<id>] resumes dispatched runs.
set -euo pipefail
device=${1:?usage: run.sh <tvos|macos> [app-ref] [workflow-ref]}
ref=${2:-$(git rev-parse --abbrev-ref HEAD)}
wfref=${3:-$ref}
root=${LEGEND_ROOT:?set LEGEND_ROOT to the legend directory root}
case $device in
  tvos) dest=$root/apple/tvos; screens_args=() ;;
  macos) dest=$root/macos/dev; screens_args=(-f "suite_args=--only screens") ;;
  *) echo "device must be tvos or macos" >&2; exit 2 ;;
esac
repo=PlayarrApp/playarr
# SCREENS=home,movies limits the screens (suite --screens); the build is cached per device by the workflow (DerivedData).
if [[ -n ${SCREENS:-} ]]; then screens_args=(-f "suite_args=--only screens --screens $SCREENS"); fi
dispatch() { # <extra gh args...>: dispatch and print the new run id
  gh workflow run parity-apple.yml -R "$repo" --ref "$wfref" -f devices="$device" -f ref="$ref" -f stream=false -f chain=false "$@" >&2
  sleep 25
  gh run list -R "$repo" -w parity-apple.yml -L 10 --json databaseId,displayTitle -q "[.[]|select(.displayTitle|contains(\"[$device]\"))][0].databaseId"
}
id=${RUN_ID:-$(dispatch ${screens_args[@]+"${screens_args[@]}"})}
dpad_id=""
if [[ $device == macos ]]; then
  dpad_id=${DPAD_RUN_ID:-$( [[ -n ${RUN_ID:-} ]] && echo "" || { sleep 30; dispatch -f capture=false -f theme=dark -f "suite_args=--only dpad --skip-player"; } )}
fi
scratch=${SCRATCH_DIR:-$root/../.apple-run-scratch}; mkdir -p "$scratch"
echo "run $id dpad-run ${dpad_id:-none}"
gh-watcher wait --repo "$repo" --run "$id" --timeout 120m --json >"$scratch/watch-$id.json" || true
[[ -z $dpad_id ]] || gh-watcher wait --repo "$repo" --run "$dpad_id" --timeout 120m --json >"$scratch/watch-$dpad_id.json" || true
# project scratch, never /tmp (SCRATCH_DIR defaults next to the legend root)
scratch=${SCRATCH_DIR:-$root/../.apple-run-scratch}
mkdir -p "$scratch"
tmp=$(mktemp -d -p "$scratch")
trap 'rm -rf "$tmp"' EXIT
gh run download "$id" -R "$repo" -D "$tmp/screens"
[[ -z $dpad_id ]] || gh run download "$dpad_id" -R "$repo" -D "$tmp/dpad" || true
mkdir -p "$dest/light"
copy_layout() { for k in layout layout-raw; do [[ ! -d $1/$k ]] || { mkdir -p "$dest/$k"; cp -r "$1/$k"/. "$dest/$k/"; }; done; }
for d in "$tmp"/screens/apple-wall-"$device"-dark-*; do cp "$d"/dark/*.png "$dest/"; copy_layout "$d"; [[ $device == macos ]] || [[ ! -f $d/dpad.json ]] || cp "$d"/dpad.json "$dest/dpad.json"; done
for d in "$tmp"/screens/apple-wall-"$device"-light-*; do cp "$d"/light/*.png "$dest/light/"; copy_layout "$d"; done
for d in "$tmp"/dpad/apple-wall-"$device"-dark-*; do [[ ! -f $d/dpad.json ]] || [[ ! -f $d/dpad.json ]] || cp "$d"/dpad.json "$dest/dpad.json"; done
# the app built is the workflow's checkout of the ref: record the SHA the run itself used and the PR of the branch
built=$(gh run view "$id" -R "$repo" --json headSha -q .headSha)
pr=$(gh pr list -R "$repo" --head "$ref" --state all --json url -q '.[0].url // ""' 2>/dev/null || true)
printf '{"branch":"%s","sha":"%s","pr":%s,"captured_at":"%s","server":"static server","run":"%s"}\n' \
  "$ref" "$built" "$([[ -n $pr ]] && printf '"%s"' "$pr" || echo null)" "$(date -u +%FT%TZ)" "$id" > "$dest/build.json"
echo "captures in $dest"
