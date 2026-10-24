#!/usr/bin/env python3
"""Cut the fractional-size Nunito Sans instances the Roku channel bundles.

A Roku Font node takes an integer size only, but the web sets type in fractional px (13.2, 15.4, 8.83). Each file here
is the web instance at one weight with unitsPerEm rescaled so the integer size round(px) draws glyphs at px.
Name: NunitoSans-<weight>-<px*100>.ttf, picked by PlayarrMakeFont in source/Fonts.brs.
Needs fontTools:  python3 scripts/make_fractional_fonts.py <path to docs/parity/fonts/NunitoSans-wght-web.ttf>
"""
import sys
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

# (weight, web px, letter-spacing px baked into every advance): keep in step with the specs in components/*.brs
CUTS = [(400, 13.2, 0), (400, 13.87, 0), (400, 15.4, 0), (680, 8.83, 0.55)]
out = Path(__file__).resolve().parents[1] / "fonts"
for weight, px, spacing in CUTS:
    font = instancer.instantiateVariableFont(TTFont(sys.argv[1]), {"wght": weight})
    font["head"].unitsPerEm = round(font["head"].unitsPerEm * round(px) / px)
    # A Label has no letter-spacing, so the cut carries it: every advance grows by spacing (web 0.035em on the dock labels).
    extra = round(spacing / px * font["head"].unitsPerEm * px / round(px)) if spacing else 0
    hmtx = font["hmtx"].metrics
    for name, (advance, bearing) in list(hmtx.items()):
        if advance:
            hmtx[name] = (advance + extra, bearing)
    # Metrics are in font units, so they must follow the new em or glyphs would stay at the old size.
    font.save(out / f"NunitoSans-{weight}-{round(px * 100)}.ttf")
