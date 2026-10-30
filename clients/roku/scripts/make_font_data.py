#!/usr/bin/env python3
"""Cut the Nunito Sans instances and advance tables the Roku channel bundles.

Roku rounds every glyph advance to whole pixels, so a Label is narrower or wider than the web's text. The channel therefore
places text by the web's own advances: fonts/NunitoSans-<weight>.json holds, per weight, the advance of every character and
the kerning of every pair (units of 1000 per em, HarfBuzz shaping of the same web font) and source/Fonts.brs positions words
with them. The instances are the web font at each weight (300 to 900 in steps of 100, within the scorer's 50 tolerance of any
web weight).

Needs fontTools and uharfbuzz:  python3 scripts/make_font_data.py <path to docs/parity/fonts/NunitoSans-wght-web.ttf>
"""
import copy
import itertools
import json
import sys
from pathlib import Path

import uharfbuzz as hb
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

# Roku sizes a Label as ceil(ascent) + ceil(descent) + 1 px, 2 to 3 px taller than the web's line box (1.364 em for this font). The
# ascent (where the baseline falls) stays; each band of font sizes gets the descent whose Label height rounds to the web's:
# NunitoSans-<weight>-<band>.ttf, chosen by source/Fonts.brs PlayarrBandFor. Units of 1000 per em.
BANDS = (("a", 105), ("b", 220), ("c", 280), ("d", 325))
WEIGHTS = (300, 400, 500, 600, 700, 800, 900)
CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .,:;'’‘-–—·•!?()[]&/+%#@\"“”…←→×°$*_=<>|~\\^{}"
out = Path(__file__).resolve().parents[1] / "fonts"
src = sys.argv[1]
face = hb.Face(hb.Blob.from_file_path(src))
font = hb.Font(face)


def width(text: str) -> int:
    buf = hb.Buffer()
    buf.add_str(text)
    buf.guess_segment_properties()
    hb.shape(font, buf, {"kern": True, "liga": False})
    return sum(p.x_advance for p in buf.glyph_positions)


for weight in WEIGHTS:
    instance = instancer.instantiateVariableFont(TTFont(src), {"wght": weight})
    # Roku sizes a Label by the Windows metrics; a browser uses the typographic ones (USE_TYPO_METRICS). Make them agree so a Label's
    # line box is the one the web font sets.
    instance["OS/2"].usWinAscent = instance["OS/2"].sTypoAscender
    instance["OS/2"].usWinDescent = -instance["OS/2"].sTypoDescender
    instance.save(out / f"NunitoSans-{weight}.ttf")
    for band, descent in BANDS:
        cut = copy.deepcopy(instance)
        cut["OS/2"].usWinDescent = descent
        cut["OS/2"].sTypoDescender = -descent
        cut["hhea"].descent = -descent
        for table in ("GPOS", "GSUB", "GDEF", "STAT"):  # the channel places words itself, from the JSON tables
            if table in cut:
                del cut[table]
        cut.save(out / f"NunitoSans-{weight}-{band}.ttf")

# Advance tables at every 10 of 300 to 900: glyphs come from the nearest instance, positions from the exact weight.
for weight in range(300, 901, 10):
    font.set_variations({"wght": weight})
    # Keys are code points: BrightScript associative arrays ignore case, so "e" and "E" would collide.
    adv = {str(ord(c)): width(c) for c in CHARS}
    kern = {f"{ord(a)}_{ord(b)}": k for a, b in itertools.product(CHARS, CHARS) if (k := width(a + b) - adv[str(ord(a))] - adv[str(ord(b))])}
    (out / f"NunitoSans-{weight}.json").write_text(json.dumps({"adv": adv, "kern": kern}, ensure_ascii=False, separators=(",", ":")))
