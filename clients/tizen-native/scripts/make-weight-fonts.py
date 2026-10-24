#!/usr/bin/env python3
"""Instance the web's variable Nunito Sans (docs/parity/fonts) at the fractional weights the web CSS uses (for example 640, 750), as
static fonts under the family name "Nunito Sans W<weight>": NUI can only pick the named weights of a family, the web interpolates.
Usage: make-weight-fonts.py <fonttools python> ... (needs fonttools): python3 make-weight-fonts.py [weights...]"""
import sys, pathlib
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
root = pathlib.Path(__file__).resolve().parents[3]
src = root / "docs/parity/fonts/NunitoSans-wght-web.ttf"
out = root / "clients/tizen-native/src/Playarr.Tizen/res/fonts"
weights = [int(w) for w in sys.argv[1:]] or [420, 437, 455, 480, 536, 552, 560, 590, 610, 620, 640, 680, 684, 720, 750, 780]
for w in weights:
    f = instancer.instantiateVariableFont(TTFont(src), {"wght": w})
    fam = f"Nunito Sans W{w}"
    for n in list(f["name"].names):
        if n.nameID in (16, 17, 21, 22, 25): f["name"].removeNames(nameID=n.nameID)
    f["name"].setName(fam, 1, 3, 1, 0x409); f["name"].setName("Regular", 2, 3, 1, 0x409)
    f["name"].setName(fam, 4, 3, 1, 0x409); f["name"].setName(fam.replace(" ", "") + "-Regular", 6, 3, 1, 0x409)
    for pid, eid, lid in ((1, 0, 0),):
        f["name"].setName(fam, 1, pid, eid, lid); f["name"].setName("Regular", 2, pid, eid, lid); f["name"].setName(fam, 4, pid, eid, lid); f["name"].setName(fam.replace(" ", "") + "-Regular", 6, pid, eid, lid)
    f["OS/2"].usWeightClass = 400
    f.save(out / f"NunitoSansW{w}.ttf")
