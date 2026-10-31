#!/usr/bin/env python3
"""Android layout exporter driver (docs/parity/LAYOUT.md): layout.py <screen> <theme dark|light> <phone|tablet> <out.json>
Asks the debug build (PlayarrLayoutExport, shared with the TV client) to write its layout, and checks the answer belongs to this capture.
PARITY_PNG_OUT=<file> saves the verified stable screenshot, so the PNG and the layout JSON describe the same frame.
Nothing is sampled from the screenshot here: backgrounds, colours, fonts and radii are the app's own paint-time values."""
import json, os, re, subprocess, sys, time, uuid

screen, theme, dev, out = sys.argv[1:5]
serial = os.environ.get("ANDROID_SERIAL", "emulator-5562" if dev == "phone" else "emulator-5568")
adb = [os.path.expanduser("~/Android/Sdk/platform-tools/adb"), "-s", serial]
pkg = "io.playarr.mobile"
r2 = lambda v: round(v, 2)

def sh(*args, binary=False):
    return subprocess.run(adb + list(args), capture_output=True, text=not binary, timeout=30).stdout

# The viewport comes from the device itself: physical size and density (160 dpi = 1 CSS px per px). The app exports CSS px already
# (it divides by its own display density), so nothing is rescaled here; the device and the export have to agree or the capture fails.
size = re.findall(r"(\d+)x(\d+)", sh("shell", "wm", "size"))
dens = re.findall(r"(\d+)", sh("shell", "wm", "density"))
if not size or not dens: sys.exit("cannot read the device size and density")
phys_w, phys_h = (int(v) for v in size[-1])
density = int(dens[-1]) / 160.0
dev_w, dev_h = phys_w / density, phys_h / density

cap_id = uuid.uuid4().hex
sh("shell", f"run-as {pkg} rm -f files/parity-layout.json")
before = sh("exec-out", "screencap", "-p", binary=True)
sh("shell", "am", "broadcast", "-a", "io.playarr.mobile.PARITY_LAYOUT", "-p", pkg, "--es", "screen", screen, "--es", "theme", theme, "--es", "id", cap_id)
raw = ""
for _ in range(30):
    time.sleep(0.5)
    raw = sh("exec-out", f"run-as {pkg} cat files/parity-layout.json")
    if raw.startswith("{"): break
if not raw.startswith("{"): sys.exit(f"layout export failed for {screen} {theme}")
after = sh("exec-out", "screencap", "-p", binary=True)
if before != after: sys.exit(f"screen changed while the layout of {screen} {theme} was exported")
doc = json.loads(raw)
if doc.get("captureId") != cap_id or doc.get("screen") != screen or doc.get("theme") != theme:
    sys.exit(f"layout export for {screen} {theme} is not the one requested (id {doc.get('captureId')!r}, screen {doc.get('screen')!r}, theme {doc.get('theme')!r})")
if doc.get("paletteDark") != (theme == "dark") or not isinstance(doc.get("occluded"), int): sys.exit(f"layout export for {screen} is in the wrong theme or incomplete")
vw, vh = doc["viewport"]["w"], doc["viewport"]["h"]
if abs(vw - dev_w) > 1 or abs(vh - dev_h) > 1: sys.exit(f"exported viewport {vw}x{vh} differs from the device {r2(dev_w)}x{r2(dev_h)} CSS px")
doc["viewport"] = {"w": vw, "h": vh, "dpr": r2(density)}
os.makedirs(os.path.dirname(out), exist_ok=True)
json.dump(doc, open(out, "w"))
# The screenshot the export was verified against (taken before and after the broadcast, byte-identical) is the one to publish with it.
png = os.environ.get("PARITY_PNG_OUT")
if png:
    with open(png + ".tmp", "wb") as f: f.write(after)
    os.replace(png + ".tmp", png)
print("layout", screen, theme, len(doc["elements"]), "elements")
