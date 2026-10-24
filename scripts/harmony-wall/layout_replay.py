#!/usr/bin/env python3
"""layout_replay.py <phone|tv> <pulled dir> <out dir>: re-export the raw inspector trees a hosted run saved (<pulled>/layout-raw/<theme>/<screen>.json)
with this checkout's exporter (HarmonyOS shaping needs `pip install uharfbuzz pillow`; without uharfbuzz widths fall back to PIL) and write
<out>/layout/<theme>/<screen>.json beside the screenshots in <pulled>/dev."""
import glob, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import layout_export
from PIL import Image

dev, pulled, out = sys.argv[1:4]
viewport = (360, 780, 3) if dev == "phone" else (1920, 1080, 1)
for theme in ("dark", "light"):
    dest = os.path.join(out, "layout", theme)
    os.makedirs(dest, exist_ok=True)
    for raw in sorted(glob.glob(os.path.join(pulled, "layout-raw", theme, "*.json"))):
        name = os.path.basename(raw)[:-5]
        shot = os.path.join(pulled, "dev", "light" if theme == "light" else "", name + ".png")
        image = Image.open(shot) if os.path.exists(shot) else None
        os.environ.setdefault("HX_BG", "props")
        doc = layout_export.export(json.load(open(raw)), name, theme, viewport, True, image=image)
        json.dump(doc, open(os.path.join(dest, name + ".json"), "w"))
