#!/usr/bin/env bash
# D-pad check on the host smoke (Qt 5.15, offscreen): nav rail Left/Right order, Up from the rail to search,
# Enter starts editing the search field, Escape ends it. usage: dpad-nav.sh [path-to-playarr-smoke]
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd); root=$here/../..
tmp=$(mktemp -d); trap 'kill ${srv:-0} 2>/dev/null || true; rm -rf "$tmp"' EXIT
bin=${1:-}
if [ -z "$bin" ]; then (cd "$tmp" && qmake-qt5 "$here/smoke.pro" >/dev/null && make -j"$(nproc)" >/dev/null); bin=$tmp/playarr-smoke; fi
port=${PORT:-18769}
python3 "$root/tests/fake_server.py" "$port" >/dev/null 2>&1 & srv=$!
mkdir -p "$tmp/h/.config/harbour-playarr"
cat > "$tmp/h/.config/harbour-playarr/harbour-playarr.conf" <<C
[General]
active=u1
theme=dark
profiles\1\userId=u1
profiles\1\name=Tester
profiles\1\deviceId=d1
profiles\1\access=tok
profiles\1\refresh=ref
profiles\1\server=http://127.0.0.1:$port
profiles\1\expiresAt=4102444800
profiles\size=1
C
sleep 1
find() { echo "(function f(o){for(var i=0;i<o.children.length;i++){var c=o.children[i];if($1)return c;var r=f(c);if(r)return r}return null})(pageStack.currentPage)"; }
prof=$(find 'c.objectName==="parity-nav-profile"'); inp=$(find 'c.hasOwnProperty("editing")')
rep="js:console.log(\"SMK editing=\"+$inp.editing)"
run() { HOME=$tmp/h XDG_CONFIG_HOME=$tmp/h/.config QT_QPA_PLATFORM=offscreen QT_QUICK_BACKEND=software SMOKE_ASSETS=$root/../../docs/parity/avatars SMOKE_STEPS="$1" timeout 150 "$bin" 2>&1 | grep -a "PARITY|focus\|SMK" | sed 's/PARITY|focus|//; s/|.*//; s/SMK //' | tr '\n' ' '; }
rail=$(run "wait|wait|wait|js:pageStack.currentPage.section=\"movies\"|wait|wait|wait|js:$prof.forceActiveFocus()|wait|key:Right|wait|key:Right|wait|key:Right|wait|key:Left|wait|key:Up|wait")
[ "$rail" = "profile downloads search home search " ] || { echo "FAIL rail/up: $rail"; exit 1; }
edit=$(run "wait|wait|wait|js:pageStack.currentPage.section=\"search\"|wait|wait|wait|$rep|key:Return|wait|$rep|key:Escape|wait|$rep")
[ "$(printf %s "$edit" | grep -o "editing=[a-z]*" | tr "\n" " ")" = "editing=false editing=true editing=false " ] || { echo "FAIL search edit: $edit"; exit 1; }
echo "PASS dpad-nav: $rail| $edit"
