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
# The app exports CSS px already (device px over its display density), radii included: nothing is converted, tagged or asserted here.
assert doc["viewport"]["w"] == view[0] and doc["viewport"]["h"] == view[1], "exported viewport %s is not %s" % (doc["viewport"], view)
os.makedirs(os.path.dirname(out), exist_ok=True)
json.dump(doc, open(out, "w"))
print("layout", screen, theme, len(doc["elements"]), "elements")
