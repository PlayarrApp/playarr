#!/usr/bin/env bash
# port_free sees a listener on loopback and sees a free port as free. Run: bash scripts/parity/static/port-free.test.sh
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/port-free.sh"
port=$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1])')
port_free "$port" || { echo "FAIL: a free port reported busy"; exit 1; }
python3 -c "import socket,time;s=socket.socket();s.bind(('127.0.0.1',$port));s.listen();time.sleep(5)" & pid=$!
trap 'kill $pid 2>/dev/null || true' EXIT
for _ in $(seq 1 30); do port_free "$port" || break; sleep 0.1; done
! port_free "$port" || { echo "FAIL: a busy port reported free"; exit 1; }
echo "port-free: ok"
