#!/usr/bin/env python3
"""Android layout exporter driver (docs/parity/LAYOUT.md): layout.py <screen> <theme dark|light> <phone|tablet> <out.json>
Asks the debug build (PlayarrLayoutExport, shared with the TV client) to write its layout, and checks the answer belongs to this capture.
PARITY_PNG_OUT=<file> saves the verified stable screenshot, so the PNG and the layout JSON describe the same frame.
Nothing is sampled from the screenshot here: backgrounds, colours, fonts and radii are the app's own paint-time values."""
import io, json, os, re, subprocess, sys, time, uuid
from PIL import Image

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
sh("shell", "am", "broadcast", "-a", "io.playarr.mobile.PARITY_LAYOUT", "-p", pkg, "--es", "screen", screen, "--es", "theme", theme, "--es", "id", cap_id, "--ez", "rendered", "true")
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

# Real-screen occlusion (docs/parity/LAYOUT.md), same toggle-and-diff as the TV driver: the app flags rows that lie wholly inside a
# higher window's opaque container or a later painted box of the same window; a flagged row is kept only if the pixels of its own
# rectangle change when that cover is hidden (otherwise it was not showing).
def cover(on, ids):
    sh("shell", "am", "broadcast", "-a", "io.playarr.mobile.PARITY_COVER", "-p", pkg, "--ez", "on", "true" if on else "false", "--es", "ids", ",".join(map(str, ids)) if ids else "none")

def hidden_shot(windows, ids):
    try:
        cover(windows, ids)
        time.sleep(0.8)
        return Image.open(io.BytesIO(sh("exec-out", "screencap", "-p", binary=True))).convert("RGB")
    finally:
        cover(False, [])
        time.sleep(0.5)

shown = Image.open(io.BytesIO(after)).convert("RGB")
def changed_fraction(e, other):
    r = e["rect"]
    x0, y0 = max(0, int(r["x"] * density)), max(0, int(r["y"] * density))
    x1, y1 = min(shown.width, int(-(-(r["x"] + r["w"]) * density // 1))), min(shown.height, int(-(-(r["y"] + r["h"]) * density // 1)))
    a, b = shown.crop((x0, y0, x1, y1)).getdata(), other.crop((x0, y0, x1, y1)).getdata()
    total = len(a)
    changed = sum(1 for p, q in zip(a, b) if abs(p[0] - q[0]) + abs(p[1] - q[1]) + abs(p[2] - q[2]) > 24)
    return changed / total if total else 0

def samples_changed(e, other):
    # docs/parity/LAYOUT.md: the 3 x 3 grid (20%, 50%, 80%) of the part of the element on the screen; covered when the pixel at every point changes with the cover hidden.
    r = e["rect"]
    x0, y0 = max(0.0, r["x"] * density), max(0.0, r["y"] * density)
    x1, y1 = min(float(shown.width), (r["x"] + r["w"]) * density), min(float(shown.height), (r["y"] + r["h"]) * density)
    if x1 <= x0 or y1 <= y0: return False
    for fy in (0.2, 0.5, 0.8):
        for fx in (0.2, 0.5, 0.8):
            px, py = min(shown.width - 1, int(x0 + (x1 - x0) * fx)), min(shown.height - 1, int(y0 + (y1 - y0) * fy))
            p, q = shown.getpixel((px, py)), other.getpixel((px, py))
            if abs(p[0] - q[0]) + abs(p[1] - q[1]) + abs(p[2] - q[2]) <= 24: return False
    return True

flagged = [e for e in doc["elements"] if e.get("covered")]
drop = set()
window_level = [e for e in flagged if not e.get("coverIds")]
same_window = [e for e in flagged if e.get("coverIds")]
if window_level:
    bare = hidden_shot(True, [])
    for e in window_level:
        if changed_fraction(e, bare) == 0: drop.add(id(e))
groups = []
for e in same_window:
    for g in groups:
        if not any(c in m["chainIds"] for c in e["coverIds"] for m in g["members"]) and not any(h in e["chainIds"] for h in g["hide"]):
            g["members"].append(e); g["hide"] += [c for c in e["coverIds"] if c not in g["hide"]]; break
    else: groups.append({"members": [e], "hide": list(e["coverIds"])})
for g in groups:
    bare = hidden_shot(False, g["hide"])
    for e in g["members"]:
        if samples_changed(e, bare): drop.add(id(e))
for e in doc["elements"]:
    for k in ("covered", "coverIds", "chainIds"): e.pop(k, None)
if flagged and sh("exec-out", "screencap", "-p", binary=True) != after: sys.exit(f"screen did not return after the cover check of {screen} {theme}")
doc["elements"] = [e for e in doc["elements"] if id(e) not in drop]
doc["occluded"] = len(drop)
print("occluded", len(drop), "of", len(flagged), "flagged", file=sys.stderr)
os.makedirs(os.path.dirname(out), exist_ok=True)
json.dump(doc, open(out, "w"))
# The screenshot the export was verified against (taken before and after the broadcast, byte-identical) is the one to publish with it.
png = os.environ.get("PARITY_PNG_OUT")
if png:
    with open(png + ".tmp", "wb") as f: f.write(after)
    os.replace(png + ".tmp", png)
print("layout", screen, theme, len(doc["elements"]), "elements")
