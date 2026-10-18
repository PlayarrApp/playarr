#!/usr/bin/env bash
# D-pad check on the host smoke (Qt 5.15, offscreen): on Search the field holds initial focus, Down leaves it, Up from the
# nav returns to it (a Loader holding focus for its content must not swallow the move), and Return/Escape start/stop editing.
# usage: dpad-search.sh [path-to-playarr-smoke]   (default: builds smoke.pro in a temp dir)
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd); root=$here/../..
tmp=$(mktemp -d); trap 'kill ${srv:-0} 2>/dev/null || true; rm -rf "$tmp"' EXIT
bin=${1:-}
if [ -z "$bin" ]; then (cd "$tmp" && qmake-qt5 "$here/smoke.pro" >/dev/null && make -j"$(nproc)" >/dev/null); bin=$tmp/playarr-smoke; fi
port=$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1])')
python3 "$root/tests/fake_server.py" $port >/dev/null 2>&1 & srv=$!
mkdir -p "$tmp/h/.config/harbour-playarr"
cat > "$tmp/h/.config/harbour-playarr/harbour-playarr.conf" <<C
[General]
active=u1
theme=dark
profiles\\1\userId=u1
profiles\\1\name=Tester
profiles\\1\deviceId=d1
profiles\\1\access=tok
profiles\\1\refresh=ref
profiles\\1\server=http://127.0.0.1:$port
profiles\\1\avatar=
profiles\\1\pinLocked=false
profiles\\1\expiresAt=4102444800
profiles\\size=1
C
for _ in $(seq 40); do curl -s -o /dev/null http://127.0.0.1:$port/ && break; sleep 0.25; done
field='(function f(o){for(var i=0;i<o.children.length;i++){var c=o.children[i];if(c.editing!==undefined&&c.cursorVisible!==undefined)return c;var r=f(c);if(r)return r}return null})(pageStack.currentPage.loaderItem())'
steps="wait|wait|wait|js:pageStack.currentPage.section=\"search\"|wait|wait|wait|key:Down|wait|key:Up|wait|js:$field.forceActiveFocus()|key:Return|wait|observe:\"EDIT=\"+$field.editing|key:Escape|wait|observe:\"EDIT=\"+$field.editing"
out=$(HOME=$tmp/h XDG_CONFIG_HOME=$tmp/h/.config QT_QPA_PLATFORM=offscreen QT_QUICK_BACKEND=software SMOKE_ASSETS=$root/../../docs/parity/avatars SMOKE_STEPS="$steps" timeout 120 "$bin" 2>&1 | grep -a "PARITY|focus\|SMOKE_OBSERVE\|SMOKE_KEY_SENT" || true)
focus=$(printf '%s\n' "$out" | grep -a "PARITY|focus" | sed 's/.*focus|//; s/|.*//' | head -4 | paste -sd,)
edits=$(printf '%s\n' "$out" | grep -a -o "= EDIT=[a-z]*$" | sed "s/= //" | paste -sd,)
[ "$focus" = "search,series,search,search" ] || { echo "FAIL focus order: $focus"; exit 1; }
[ "$edits" = "EDIT=true,EDIT=false" ] || { echo "FAIL editing: $edits"; exit 1; }
echo "PASS dpad-search: $focus; $edits"
