#!/usr/bin/env bash
# Full 16-screen, two-theme Sailfish capture and PNG-only legend publication.
set -euo pipefail
HERE=$(cd -- "$(dirname -- "$0")" && pwd)
exec node "$HERE/capture-legend.mjs" "$@"
