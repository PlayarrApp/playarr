#!/usr/bin/env bash
# Tests for deck-unchanged.sh: the stray-row output fails, the clean output passes, garbage fails.
set -u
here=$(cd "$(dirname "$0")" && pwd)
run() { printf '%s\n' "$1" | bash "$here/deck-unchanged.sh" >/dev/null 2>&1; echo $?; }
[ "$(run 'would clear 0 rows; part_watched now 1')" = 0 ] || { echo "FAIL clean"; exit 1; }
[ "$(run 'would clear 2 rows; part_watched now 3')" = 3 ] || { echo "FAIL stray"; exit 1; }
[ "$(run '')" = 3 ] || { echo "FAIL empty"; exit 1; }
[ "$(run 'login 500')" = 3 ] || { echo "FAIL garbage"; exit 1; }
echo "deck-unchanged: ok"
