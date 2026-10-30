#!/usr/bin/env python3
"""Splits the shared avatar plates (clients/shared/profile-avatars/plates/<id>.svg) into the two layers web draws: the circular plate
(gradient and sheen) and the artwork on top at 86 %. Writes res/avatars/plate-<id>.png (264 px) and res/avatars/art-<id>.png (227 px).
Needs rsvg-convert."""
import pathlib, re, subprocess

root = pathlib.Path(__file__).resolve().parent.parent
plates = root.parent / "shared/profile-avatars/plates"
out = root / "src/Playarr.Tizen/res/avatars"
for svg in sorted(plates.glob("*.svg")):
    text = svg.read_text()
    m = re.search(r'(<g transform="translate\([^"]*\) scale\(([\d.]+)\)">)(.*?)</g>\n</g>\n</svg>', text, re.S)
    if not m:
        raise SystemExit(f"{svg.name}: artwork group not found")
    scale = float(m.group(2))
    plate = text[:m.start()] + "</g>\n</svg>\n"
    art = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">'
           + "<g>" + m.group(3) + "</g></svg>")
    (out / f"plate-{svg.stem}.png").write_bytes(subprocess.check_output(["rsvg-convert", "-w", "264", "-h", "264"], input=plate.encode()))
    (out / f"art-{svg.stem}.png").write_bytes(subprocess.check_output(["rsvg-convert", "-w", "227", "-h", "227"], input=art.encode()))
    print(svg.stem, scale)
