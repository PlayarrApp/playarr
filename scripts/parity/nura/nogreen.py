"""usage: nogreen.py frame.png  exit 1 when the frame holds a solid block of the VM's green fill (uninitialised display tile)."""
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert("RGB").crop((0, 70, 720, 1410))
px = im.load()
w, h = im.size
# Solid green block: every sampled pixel of a 16x16 patch is strongly green. App art is never this saturated.
for y in range(0, h - 16, 8):
    for x in range(0, w - 16, 8):
        if all(g > r + 70 and g > b + 50 and g > 140
               for r, g, b in (px[x + i, y + j] for i in (0, 8, 15) for j in (0, 8, 15))):
            sys.exit(1)
sys.exit(0)
