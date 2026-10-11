#!/usr/bin/env python3
"""Drives the Previewer through the bridge (harmony_vnc.py control port) and writes the parity captures.
Usage: capture.py <tv|phone> <out-dir> <previewer.log>   Environment: SERVER_URL, TEST_USERNAME, TEST_PASSWORD (approve_link.py).
Signs in fresh (link code logged by the app, approved as the Device Test account), picks the "Device Test" profile, then captures
dark and light. Aborts, writing nothing more, when a frame is too plain (an error or signed-out screen)."""
import io, json, os, re, subprocess, sys, time, urllib.parse, urllib.request
from PIL import Image

device, out, log = sys.argv[1], sys.argv[2], sys.argv[3]
CTL = "http://127.0.0.1:" + ("40117" if device == "phone" else "40017")
HERE = os.path.dirname(os.path.abspath(__file__))
os.makedirs(out, exist_ok=True)


def get(path, **q):
    url = CTL + path + ("?" + urllib.parse.urlencode(q) if q else "")
    with urllib.request.urlopen(url, timeout=30) as r:
        return r.read()


def png() -> Image.Image:
    return Image.open(io.BytesIO(get("/shot.png"))).convert("RGB")


def key(*names):
    for n in names:
        get("/key/" + n)
        time.sleep(0.35)


def click(x, y):
    get("/click", x=x, y=y)


def route(name, wait=12):
    get("/setroute", name=name)
    time.sleep(wait)


def too_plain(img: Image.Image, floor: int) -> bool:
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.tell() < floor


def abort(msg):
    print("ABORT: " + msg, flush=True)
    sys.exit(1)


def settle(limit=45):
    """Wait until the frame stops changing (posters and lists arrive after the route does): two equal polls 4 s apart."""
    last, end = None, time.time() + limit
    while time.time() < end:
        cur = png().tobytes()
        if cur == last:
            return
        last = cur
        time.sleep(4)


def snap(name, folder, floor=60000):
    settle()
    img = png()
    os.makedirs(folder, exist_ok=True)
    if too_plain(img, floor) and not os.environ.get("CALIBRATE"):
        img.save(os.path.join(out, "_rejected-" + name + ".png"))
        abort(f"{name} is too plain: an error or signed-out screen")
    img.save(os.path.join(folder, name + ".png"))
    print("captured", name, flush=True)


def debug(name):
    d = os.path.join(out, "_debug")
    os.makedirs(d, exist_ok=True)
    png().save(os.path.join(d, name + ".png"))


for _ in range(30):
    if b"cmd=up" in get("/health"):
        break
    time.sleep(2)
else:
    abort("the Previewer never connected to the command pipe")

# 1. sign in: point the app at the test server (typed through the bridge, never baked into the build), then the pairing page logs
# its user code; approve it as the Device Test account (fresh device id each run)
route("serversetup", 8)
debug("serversetup")
click(960, 549); time.sleep(1)
get("/type", text=os.environ["SERVER_URL"].strip()); time.sleep(1)
click(960, 627); time.sleep(8)
code = None
for _ in range(60):
    found = re.findall(rb"PLAYARR_LINKCODE=([A-Z0-9-]+) END", open(log, "rb").read())
    if len(found) >= 2:  # the first belongs to the hosted-link default pairing page, the last to the test server
        code = found[-1].decode()
        break
    time.sleep(2)
if code is None:
    abort("no link code for the test server in the Previewer log")
if subprocess.run([sys.executable, os.path.join(HERE, "approve_link.py"), code]).returncode != 0:
    abort("link code approval failed")
time.sleep(20)
debug("after-approve")

# 2. the profile picker: pick Device Test (alien avatar). Position found by looking at the picker, see PROFILE_CLICK.
PROFILE_CLICK = {"tv": (846, 505), "phone": (540, 900)}[device]
click(*PROFILE_CLICK)
time.sleep(20)
debug("after-profile")

SCREENS_TV = None


def walk(folder, suffix):
    """The route-based screen walk (captures as <id><suffix>.png). Clicks only inside pages."""
    n = lambda s: s + suffix
    snap(n("home"), folder, 150000)
    route("library:movie", 15); snap(n("movies"), folder, 150000)
    click(1877, 187); time.sleep(5); snap(n("filters"), folder); click(1850, 78); time.sleep(3)
    click(946, 254); time.sleep(12); snap(n("film-detail"), folder); key("back"); time.sleep(3); key("back"); time.sleep(4)
    route("library:series", 15); snap(n("series"), folder, 150000)
    click(946, 254); time.sleep(12); snap(n("series-detail"), folder); key("back"); time.sleep(3); key("back"); time.sleep(4)
    route("library:artist", 15); snap(n("music"), folder, 150000)
    route("calendar", 18); snap(n("calendar-agenda"), folder)
    click(1877, 272); time.sleep(4); click(1740, 218); time.sleep(12); click(1850, 78); time.sleep(3); snap(n("calendar-week"), folder)
    click(1877, 272); time.sleep(4); click(1830, 218); time.sleep(12); click(1850, 78); time.sleep(3); snap(n("calendar-month"), folder)
    route("search", 12); snap(n("search"), folder)
    route("settings", 8); snap(n("settings"), folder)


if device == "tv":
    folder = os.path.join(out, "dark")
    route("profiles", 6); snap("profiles", folder)
    # profiles picker -> home needs the same click as the first time
    click(*PROFILE_CLICK); time.sleep(20)
    walk(folder, "")
    # light: Settings theme toggle (coordinates of the Mac scripts), then the same walk
    route("settings", 8); click(394, 207); time.sleep(3); click(1295, 285); time.sleep(4)
    route("profiles", 6); snap("profiles", os.path.join(out, "light"))
    click(*PROFILE_CLICK); time.sleep(20)
    walk(os.path.join(out, "light"), "")
else:
    debug("phone-home")
    route("profiles", 6); debug("phone-profiles")
import datetime
json.dump({"branch": os.environ.get("BRANCH", "unknown"), "sha": os.environ.get("SHA", "unknown"), "pr": None,
           "captured_at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")},
          open(os.path.join(out, "build.json"), "w"))
print("done")
