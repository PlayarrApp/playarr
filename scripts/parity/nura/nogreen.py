"""usage: nogreen.py frame.png  exit 1 when the frame holds an unpainted VM display tile.

Two signatures: a solid block of the VM's green fill, or a solid black block outlined by a straight green edge.
Poster art can hold pure black or a little green, but not a long straight run of strong green, so black alone is ignored.
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


bad = solid_block(green, 16) or (
    int(black.sum()) >= 600 and (has_run(green, 24) or has_run(green.T, 24))
)
sys.exit(1 if bad else 0)
