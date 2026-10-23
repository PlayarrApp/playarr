#!/usr/bin/env bash
# One command for the Android phone or tablet parity run on the static server (both themes), then score and publish.
#   PARITY_LEGEND_ROOT=<legend evidence root> PARITY_OUT=<scratch dir> scripts/parity/android-mobile/run.sh <phone|tablet> [screen...]
# Needs the emulator booted headless and signed in (emu-setup.sh, signin.sh) and the sideload debug APK installed.
# Defaults: all 15 screens (the player-controls screen plays the 60 s clip and pauses it at 2 s). Captures land in
# $PARITY_OUT/<device>/{dark,light}, are scored against <legend>/android-<device>/web, and replace <legend>/android-<device>/dev
# (old PNGs removed, JSON kept) with a build.json. PARITY_PUBLISH=0 scores only.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
dev=${1:?phone or tablet}; shift
case $dev in
  phone) cap=$here/phone/cap.sh; export ANDROID_SERIAL=${ANDROID_SERIAL:-emulator-5562} ;;
  tablet) cap=$here/tablet/cap.sh; export ANDROID_SERIAL=${ANDROID_SERIAL:-emulator-5568} ;;
  *) echo "device must be phone or tablet" >&2; exit 2 ;;
esac
legend=${PARITY_LEGEND_ROOT:?legend evidence root required}/android-$dev
out=${PARITY_OUT:?scratch output dir required}/$dev
screens=("$@"); [ ${#screens[@]} -gt 0 ] || screens=(home movies series music calendar-month calendar-week calendar-agenda search film-detail series-detail settings filters profiles player-controls actions)
eval "$(node "$here/../parity-config.mjs" --shell)"
export PARITY_CLOCK
for t in Dark Light; do
  d=$out/$(echo "$t" | tr A-Z a-z); rm -rf "$d"; mkdir -p "$d"
  "$cap" "$d" "$t" "${screens[@]}"
done
mkdir -p "$out"
node "$here/score.mjs" "$legend/web" "$out" --json "$out/scores.json"
[ "${PARITY_PUBLISH:-1}" = 1 ] || exit 0
sha=$(git -C "$here" rev-parse HEAD); branch=$(git -C "$here" rev-parse --abbrev-ref HEAD)
mkdir -p "$legend/dev/light"
rm -f "$legend/dev/"*.png "$legend/dev/light/"*.png
cp "$out/dark/"*.png "$legend/dev/"; cp "$out/light/"*.png "$legend/dev/light/"
cp "$out/scores.json" "$legend/dev/scores.json"
for d in "$legend/dev" "$legend/dev/light"; do
  printf '{"branch":"%s","sha":"%s","pr":%s,"captured_at":"%s","server":"static server"}\n' "$branch" "$sha" "${PARITY_PR:-null}" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$d/build.json"
done
echo "published to the legend dir ($dev)"
