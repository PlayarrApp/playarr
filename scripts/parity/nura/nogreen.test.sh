#!/usr/bin/env bash
# Mock frames for nogreen.py: a black tile with a green edge is rejected, plain black art or a little green is not.
set -euo pipefail

ROOT=$(cd -- "$(dirname -- "$0")" && pwd)
SCRATCH=${PLAYARR_TEST_TMPDIR:-}
if [ -z "$SCRATCH" ] || [ ! -d "$SCRATCH" ]; then
  echo 'set PLAYARR_TEST_TMPDIR to an existing scratch directory' >&2
  exit 2
fi
T=$SCRATCH/nura-nogreen-test-$$
mkdir -p "$T"
fail() { echo "FAIL: $*" >&2; exit 1; }

python3 -I - "$T" <<'PY'
import sys
from PIL import Image, ImageDraw

def frame(name, draw):
    im = Image.new("RGB", (720, 1440), (40, 40, 44))
    draw(ImageDraw.Draw(im))
    im.save(f"{sys.argv[1]}/{name}.png")

G = (20, 220, 20)
frame("clean", lambda d: None)
frame("green-block", lambda d: d.rectangle((100, 300, 140, 340), fill=G))
frame("black-green-edge", lambda d: (d.rectangle((0, 400, 63, 463), fill=(0, 0, 0)), d.rectangle((64, 400, 66, 463), fill=G)))
frame("black-only", lambda d: d.rectangle((0, 400, 63, 463), fill=(0, 0, 0)))
frame("black-short-green", lambda d: (d.rectangle((0, 400, 63, 463), fill=(0, 0, 0)), d.rectangle((64, 400, 66, 410), fill=G)))
PY

bad() { ! python3 -I "$ROOT/nogreen.py" "$T/$1.png"; }
ok() { python3 -I "$ROOT/nogreen.py" "$T/$1.png"; }
ok clean || fail "clean frame rejected"
bad green-block || fail "solid green block accepted"
bad black-green-edge || fail "black tile with a green edge accepted"
ok black-only || fail "black art without a green edge rejected"
ok black-short-green || fail "short green run beside black rejected"
echo "nogreen mocked regression checks passed"
