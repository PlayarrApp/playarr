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
frame("black-band", lambda d: d.rectangle((0, 624, 63, 627), fill=(0, 0, 0)))
frame("black-band-wide", lambda d: d.rectangle((0, 624, 200, 627), fill=(0, 0, 0)))
frame("black-letterbox", lambda d: d.rectangle((0, 624, 719, 631), fill=(0, 0, 0)))
frame("black-short-run", lambda d: d.rectangle((0, 624, 40, 627), fill=(0, 0, 0)))
frame("black-header-bits", lambda d: d.rectangle((60, 124, 63, 127), fill=(0, 0, 0)))
frame("black-only", lambda d: d.rectangle((0, 400, 63, 463), fill=(0, 0, 0)))
frame("black-short-green", lambda d: (d.rectangle((0, 400, 63, 463), fill=(0, 0, 0)), d.rectangle((64, 400, 66, 410), fill=G)))
PY

bad() { ! python3 -I "$ROOT/nogreen.py" "$T/$1.png"; }
ok() { python3 -I "$ROOT/nogreen.py" "$T/$1.png"; }
ok clean || fail "clean frame rejected"
bad green-block || fail "solid green block accepted"
bad black-green-edge || fail "black tile with a green edge accepted"
bad black-band || fail "thin black tile band accepted"
ok black-band-wide || fail "wide black line rejected"
ok black-letterbox || fail "full-width black line rejected"
ok black-short-run || fail "short black run rejected"
bad black-header-bits || fail "black bits in the header band accepted"
ok black-only || fail "black art without a green edge rejected"
ok black-short-green || fail "short green run beside black rejected"
echo "nogreen mocked regression checks passed"
