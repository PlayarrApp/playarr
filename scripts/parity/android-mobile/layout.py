#!/usr/bin/env python3
"""Android layout exporter (docs/parity/LAYOUT.md): layout.py <screen> <theme dark|light> <phone|tablet> <screenshot.png> <out.json>
Asks the debug build for its Compose semantics export (ParityLayoutExport), converts device px to CSS px, and fills the
background colour from the screenshot (the median of a ring just outside each element's box; Compose semantics carry none)."""
import json, os, subprocess, sys, time
from collections import Counter
from PIL import Image

screen, theme, dev, shot, out = sys.argv[1:6]
serial = os.environ.get("ANDROID_SERIAL", "emulator-5562" if dev == "phone" else "emulator-5568")
adb = [os.path.expanduser("~/Android/Sdk/platform-tools/adb"), "-s", serial]
view = {"phone": (390, 845, 719 / 390), "tablet": (1280, 800, 2.0)}[dev]
pkg = "io.playarr.mobile"
subprocess.run(adb + ["shell", f"run-as {pkg} rm -f files/parity-layout.json"], capture_output=True)
subprocess.run(adb + ["shell", "am", "broadcast", "-a", "io.playarr.mobile.PARITY_LAYOUT", "-p", pkg], capture_output=True)
raw = ""
for _ in range(20):
    raw = subprocess.run(adb + ["exec-out", f"run-as {pkg} cat files/parity-layout.json"], capture_output=True, text=True).stdout
    if raw.startswith("{"): break
    time.sleep(0.5)
data = json.loads(raw)
if "error" in data: raise SystemExit("export failed: " + data["error"])
dpr = data["widthPx"] / view[0]
img = Image.open(shot).convert("RGB")
W, H = img.size
def bg(x, y, w, h):
    px = []
    x0, y0, x1, y1 = int(x) - 2, int(y) - 2, int(x + w) + 2, int(y + h) + 2
    for xx in range(max(0, x0), min(W, x1), max(1, (x1 - x0) // 12)):
        for yy in (y0, y1 - 1):
            if 0 <= yy < H: px.append(img.getpixel((xx, yy)))
    for yy in range(max(0, y0), min(H, y1), max(1, (y1 - y0) // 12)):
        for xx in (x0, x1 - 1):
            if 0 <= xx < W: px.append(img.getpixel((xx, yy)))
    if not px: return None
    c = Counter(px).most_common(1)[0][0]
    return "#%02x%02x%02x" % c
els = []
r2 = lambda v: round(v, 2)
for e in data["elements"]:
    if e["x"] + e["w"] < 0 or e["y"] + e["h"] < 0 or e["x"] > W or e["y"] > H: continue
    istext = e.get("fontSizePx") is not None
    els.append({"text": " ".join(e["text"].split()), "role": e["role"],
                "rect": {"x": r2(e["x"] / dpr), "y": r2(e["y"] / dpr), "w": r2(e["w"] / dpr), "h": r2(e["h"] / dpr)},
                "color": e.get("color") if istext else None, "background": bg(e["x"], e["y"], e["w"], e["h"]),
                "fontSize": r2(e["fontSizePx"] / dpr) if istext else None, "fontWeight": e.get("fontWeight") if istext else None})
os.makedirs(os.path.dirname(out), exist_ok=True)
json.dump({"screen": screen, "theme": theme, "viewport": {"w": view[0], "h": view[1], "dpr": dpr}, "clockPinned": True, "elements": els}, open(out, "w"), indent=0)
print("layout", screen, theme, len(els), "elements")
