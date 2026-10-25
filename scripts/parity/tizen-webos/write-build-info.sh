#!/usr/bin/env bash
# write-build-info.sh <app dir>: records what the deployed package is, for the suite driver's build identity check:
# repository HEAD, build time (the dist build-manifest, else now) and the SHA-256 of the entry bundle the page loads first.
# A working tree with uncommitted changes under clients/tv-web is refused: the identity would name a build nobody can rebuild.
set -euo pipefail
app=${1:?app dir}
here=$(cd "$(dirname "$0")" && pwd)
repo=$(git -C "$here" rev-parse --show-toplevel)
if [ -n "$(git -C "$repo" status --porcelain -- clients/tv-web scripts/parity | grep -v 'build-manifest.json' || true)" ]; then
  echo "write-build-info: uncommitted changes in clients/tv-web or scripts/parity; commit first" >&2; exit 1
fi
entry=$(grep -o 'src="[^"]*assets/[^"]*\.js"' "$app/index.html" | head -1 | sed 's/^src="//; s/"$//; s#^\./##')
[ -n "$entry" ] || { echo "write-build-info: no entry bundle in $app/index.html" >&2; exit 1; }
digest=$(sha256sum "$app/$entry" | cut -d' ' -f1)
built=$(date -u +%Y-%m-%dT%H:%M:%SZ)
printf '{"sha":"%s","builtAt":"%s","bundleSha256":"%s"}\n' "$(git -C "$repo" rev-parse HEAD)" "$built" "$digest" > "$app/parity-build.json"
