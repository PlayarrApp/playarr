#!/usr/bin/env bash
# usage: nudge.sh  click the Nura display's left margin, where no screen has a control, then let it repaint.
# After the app has sat idle for tens of seconds the VM display keeps showing the frame from before a sheet or drawer
# opened until an input event reaches the app. A pointer move or a key press does not do it; a click does.
set -euo pipefail
H=$(cd -- "$(dirname -- "$0")" && pwd)
"$H/vnc.sh" postmarketos move 3 700 click 1 >/dev/null 2>&1
sleep "${NURA_NUDGE_WAIT:-3}"
