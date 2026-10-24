#!/usr/bin/env python3
"""Android layout exporter driver (docs/parity/LAYOUT.md): layout.py <screen> <theme dark|light> <phone|tablet> <out.json>
Asks the debug build (PlayarrLayoutExport, shared with the TV client) to write its layout, then converts device px to CSS px.
Nothing is sampled from the screenshot here: backgrounds, colours, fonts and radii are the app's own resolved values."""
import json, os, subprocess, sys, time

screen, theme, dev, out = sys.argv[1:5]
serial = os.environ.get("ANDROID_SERIAL", "emulator-5562" if dev == "phone" else "emulator-5568")
adb = [os.path.expanduser("~/Android/Sdk/platform-tools/adb"), "-s", serial]
view = {"phone": (390, 845), "tablet": (1280, 800)}[dev]
pkg = "io.playarr.mobile"
subprocess.run(adb + ["shell", f"run-as {pkg} rm -f files/parity-layout.json"], capture_output=True)
subprocess.run(adb + ["shell", "am", "broadcast", "-a", "io.playarr.mobile.PARITY_LAYOUT", "-p", pkg, "--es", "screen", screen, "--es", "theme", theme], capture_output=True)
raw = ""
for _ in range(30):
    time.sleep(0.5)
    raw = subprocess.run(adb + ["exec-out", f"run-as {pkg} cat files/parity-layout.json"], capture_output=True, text=True).stdout
    if raw.startswith("{"): break
doc = json.loads(raw)
dpr = doc["viewport"]["w"] / view[0]
r2 = lambda v: round(v, 2)
for e in doc["elements"]:
    e["rect"] = {k: r2(v / dpr) for k, v in e["rect"].items()}
    if e.get("fontSize") is not None: e["fontSize"] = r2(e["fontSize"] / dpr)
    # A fully rounded shape (tag 50 and above) stays as tagged; any other radius is the drawn one in CSS px.
    px = e.pop("radiusPx", None)
    if e.get("radius") is not None and px is not None and e["radius"] < 50: e["radius"] = r2(px / dpr)
# Rects are exported as the app measured them: no browser-specific rounding or other correction is applied here.
doc["viewport"] = {"w": view[0], "h": view[1], "dpr": r2(dpr)}
doc["clockPinned"] = True
os.makedirs(os.path.dirname(out), exist_ok=True)
json.dump(doc, open(out, "w"))
print("layout", screen, theme, len(doc["elements"]), "elements")
