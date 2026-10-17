#!/usr/bin/env bash
# deck-unchanged.sh: reads the output of `reset-deck-canonical.mjs --dry` on stdin and exits 3 when it would still clear progress rows
# (a capture run left stray progress on the shared account). A missing or unparsable count also fails.
left=$(grep -oE 'clear [0-9]+' | grep -oE '[0-9]+' | head -n 1)
[ "${left:-x}" = 0 ] && exit 0
echo "deck changed by this run: ${left:-unknown} stray progress rows (reset with reset-deck-canonical.mjs)" >&2
exit 3
