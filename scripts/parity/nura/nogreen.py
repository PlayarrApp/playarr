"""usage: nogreen.py frame.png  exit 1 when the frame holds an unpainted VM display tile.

Three signatures: a solid block of the VM's green fill, a solid black block outlined by a straight green edge, or a
thin band of pure black that is exactly one 64 px aligned tile wide (a tile caught part-painted; the pixels beside it
and the rows above and below it are not black). Poster art can hold pure black or a little green, but not a long straight run of strong
green, so black alone is ignored.
"""
import sys

import numpy as np
from PIL import Image

a = np.asarray(Image.open(sys.argv[1]).convert("RGB").crop((0, 70, 720, 1410)), dtype=np.int16)
r, g, b = a[..., 0], a[..., 1], a[..., 2]
green = (g > r + 60) & (g > b + 30) & (g > 120)
black = ~(a.any(axis=2))


def has_run(mask, n):
    """True when any row of `mask` holds n consecutive set cells."""
    c = np.cumsum(np.pad(mask, ((0, 0), (1, 0))), axis=1, dtype=np.int32)
    return bool(((c[:, n:] - c[:, :-n]) == n).any())


def solid_block(mask, n):
    """True when an n x n square is entirely set."""
    c = np.cumsum(np.cumsum(np.pad(mask, ((1, 0), (1, 0))), axis=0, dtype=np.int32), axis=1)
    s = c[n:, n:] - c[:-n, n:] - c[n:, :-n] + c[:-n, :-n]
    return bool((s == n * n).any())


def black_tile_band(mask, tile=64, max_rows=16):
    """True when a pure-black band under `max_rows` tall spans a whole tile-aligned span of columns."""
    h, w = mask.shape
    for x0 in range(0, w - tile + 1, tile):
        full = mask[:, x0 : x0 + tile].all(axis=1)
        y = 0
        while y < h:
            if not full[y]:
                y += 1
                continue
            y1 = y
            while y1 < h and full[y1]:
                y1 += 1
            beside = [mask[y:y1, x].any() for x in (x0 - 1, x0 + tile) if 0 <= x < w]
            if y1 - y < max_rows and y > 0 and y1 < h and not any(beside):
                return True
            y = y1
    return False


def black_in_header_band(frame):
    """True when pure black pixels sit in the display rows 110..136 (just under the status bar, where every screen
    shows its header on a plain surface) while that band is mostly not black: a tile caught part-painted."""
    band = ~np.asarray(Image.open(sys.argv[1]).convert("RGB"))[110:136].any(axis=2)
    return bool(band.any()) and band.mean() < 0.5


def vm_green_bar(mask, w=24, h=4):
    """True when a w x h rectangle is entirely the VM's pure-green fill (red 0): a tile caught part-painted can leave a
    thin band of it under text, which none of the other signatures see."""
    c = np.cumsum(np.cumsum(np.pad(mask, ((1, 0), (1, 0))), axis=0, dtype=np.int32), axis=1)
    s = c[h:, w:] - c[:-h, w:] - c[h:, :-w] + c[:-h, :-w]
    return bool((s == w * h).any())


vm_green = (r <= 8) & (g > 140) & (g < 200) & (b > 60) & (b < g - 30)
bad = vm_green_bar(vm_green) or black_in_header_band(None) or black_tile_band(black) or solid_block(green, 16) or (
    int(black.sum()) >= 600 and (has_run(green, 24) or has_run(green.T, 24))
)
sys.exit(1 if bad else 0)
