#!/usr/bin/env bash
# usage: cap.sh <name> <out.png> [scale-div <scaled-out.png>]
set -euo pipefail
H=$(cd -- "$(dirname -- "$0")" && pwd)
if [ "$#" -ne 2 ] && [ "$#" -ne 4 ]; then
  echo 'usage: cap.sh <name> <out.png> [scale-div <scaled-out.png>]' >&2
  exit 2
fi

if [ "$#" -eq 4 ]; then
  [[ "$3" =~ ^[1-9][0-9]*$ ]] || { echo 'scale-div must be a positive integer' >&2; exit 2; }
fi

"$H/vnc.sh" "$1" capture "$2" 2>/dev/null

if [ "$#" -eq 4 ]; then
  "$H/venv/bin/python" -c 'from PIL import Image; import sys; source, divisor, target = sys.argv[1:]; image = Image.open(source); image.resize((image.width // int(divisor), image.height // int(divisor))).save(target)' "$2" "$3" "$4"
fi
