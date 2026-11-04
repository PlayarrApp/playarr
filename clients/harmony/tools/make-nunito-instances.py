"""Builds the static Nunito Sans instances the Harmony app registers (rawfile/fonts/NunitoSans-W<weight>.ttf).

Source: docs/parity/fonts/NunitoSans-wght-web.ttf, the web's exact wght-only instance. Each output is that font pinned at one weight, renamed
NunitoSansW<weight> and marked weight class 400, so ArkUI picks it by family name alone. Needs fontTools.

usage: make-nunito-instances.py <out dir> <weight> [<weight> ...]
"""
import sys
from pathlib import Path

from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

SRC = Path(__file__).resolve().parents[3] / "docs" / "parity" / "fonts" / "NunitoSans-wght-web.ttf"


def build(weight: int, out: Path) -> None:
    font = instancer.instantiateVariableFont(TTFont(SRC), {"wght": weight}, updateFontNames=False)
    family = f"NunitoSansW{weight}"
    names = font["name"]
    names.names = [r for r in names.names if r.nameID not in (16, 17, 25)]  # the variable font's typographic and variation names
    for name_id, text in ((1, family), (2, "Regular"), (4, family), (6, family + "-Regular")):
        names.setName(text, name_id, 3, 1, 0x409)
        names.setName(text, name_id, 1, 0, 0)
    font["OS/2"].usWeightClass = 400
    font.save(out / f"NunitoSans-W{weight}.ttf")


if __name__ == "__main__":
    target = Path(sys.argv[1])
    for w in sys.argv[2:]:
        build(int(w), target)
