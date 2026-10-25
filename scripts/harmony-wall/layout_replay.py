#!/usr/bin/env python3
"""layout_replay.py <phone|tv> <pulled dir> <out dir>: re-export the raw inspector trees a hosted run saved (<pulled>/layout-raw/<theme>/<screen>.json)
with this checkout's exporter and write <out>/layout/<theme>/<screen>.json."""
import glob, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import layout_export

dev, pulled, out = sys.argv[1:4]
viewport = (360, 780, 3) if dev == "phone" else (1920, 1080, 1)
for theme in ("dark", "light"):
    dest = os.path.join(out, "layout", theme)
    os.makedirs(dest, exist_ok=True)
    for raw in sorted(glob.glob(os.path.join(pulled, "layout-raw", theme, "*.json"))):
        name = os.path.basename(raw)[:-5]
        try:
            doc = layout_export.export(json.load(open(raw)), name, theme, viewport, True, with_src=bool(os.environ.get("WITH_SRC")))
        except layout_export.ExportError as error:
            print(f"{theme}/{name}: {error}")
            continue
        json.dump(doc, open(os.path.join(dest, name + ".json"), "w"))
