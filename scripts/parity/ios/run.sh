#!/usr/bin/env bash
# Required environment and resume instructions: docs/parity/DEVICES.md.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
exec node "$here/run.mjs" "$@"
