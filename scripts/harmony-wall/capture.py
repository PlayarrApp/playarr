#!/usr/bin/env python3
"""Drives the Previewer through the bridge (harmony_vnc.py control port) and writes the parity captures.
Usage: capture.py <tv|phone> <out-dir> <previewer.log>   Environment: SERVER_URL, TEST_USERNAME, TEST_PASSWORD (approve_link.py).
Signs in fresh (link code logged by the app, approved as the Device Test account), picks the "Device Test" profile, then captures
dark and light. Aborts, writing nothing more, when a frame is too plain (an error or signed-out screen)."""
import hashlib, io, json, os, re, subprocess, sys, time, urllib.parse, urllib.request
from PIL import Image

device, out, log = sys.argv[1], sys.argv[2], sys.argv[3]
THEME = sys.argv[4] if len(sys.argv) > 4 else "dark"  # phone: the Previewer starts in this colour mode (-cm), one job per theme. TV: the part (all, dpad, extra, playback)
CTL = "http://127.0.0.1:" + ("40117" if device == "phone" else "40017")
HERE = os.path.dirname(os.path.abspath(__file__))
os.makedirs(out, exist_ok=True)


def get(path, **q):
    url = CTL + path + ("?" + urllib.parse.urlencode(q) if q else "")
    for attempt in range(6):  # the command channel can drop for a moment (503): retry
        try:
            with urllib.request.urlopen(url, timeout=30) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code != 503 or attempt == 5:
                raise
            time.sleep(4)


def png() -> Image.Image:
    return Image.open(io.BytesIO(get("/shot.png"))).convert("RGB")


def key(*names):
    for n in names:
        get("/key/" + n)
        time.sleep(0.35)


def click(x, y):
    get("/click", x=x, y=y)


def longclick(x, y):
    get("/longclick", x=x, y=y)


def route(name, wait=12):
    get("/setroute", name=name)
    time.sleep(wait)


def too_plain(img: Image.Image, floor: int) -> bool:
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.tell() < floor


class Skip(Exception):
    pass


MISSING = []


def abort(msg):
    print("ABORT: " + msg, flush=True)
    sys.exit(1)


def guarded(name, fn):
    """Phone walk: a screen whose guard fails is skipped and listed as missing; the others still publish."""
    try:
        fn()
    except (Skip, SystemExit) as e:
        print(f"SKIP {name}: {e}", flush=True)
        MISSING.append(name)


def settle(limit=45):
    """Wait until the frame stops changing (posters and lists arrive after the route does): two equal polls 4 s apart."""
    last, end = None, time.time() + limit
    while time.time() < end:
        cur = png().tobytes()
        if cur == last:
            return
        last = cur
        time.sleep(4)


SEEN = {}


def snap(name, folder, floor=60000):
    for attempt in range(3 if device == "tv" else 1):
        try:
            snap_checked(name, folder, floor)
            return
        except SystemExit:
            if device == "phone":
                raise Skip(name)
            if attempt == 2 or device != "tv":
                raise
            print(f"{name}: retrying in 25 s (the list may still be loading)", flush=True)
            time.sleep(25)


def snap_checked(name, folder, floor):
    settle()
    if b"[JsEngine Crash]" in open(log, "rb").read():
        debug("crash-" + name)
        raise RuntimeError("the Previewer's JS engine crashed: every later frame would be the frozen last one")
    img = png()
    debug('snap-' + name)
    digest = hashlib.md5(img.tobytes()).hexdigest()
    if device == "phone" and digest in SEEN and not os.environ.get("CALIBRATE"):
        img.save(os.path.join(out, "_rejected-" + name + ".png"))
        abort(f"{name} is identical to {SEEN[digest]}: the navigation did not change the screen")
    SEEN[digest] = name
    if device == "phone" and name != "player-controls":  # the player is black in both themes
        lum = sum(img.convert("L").resize((54, 117)).tobytes()) / (54 * 117)
        if (THEME == "light") != (lum > 110):
            img.save(os.path.join(out, "_rejected-" + name + ".png"))
            abort(f"{name} has mean luminance {lum:.0f}, not a {THEME} frame")
    os.makedirs(folder, exist_ok=True)
    if too_plain(img, floor) and not os.environ.get("CALIBRATE"):
        img.save(os.path.join(out, "_rejected-" + name + ".png"))
        abort(f"{name} is too plain: an error or signed-out screen")
    img.save(os.path.join(folder, name + ".png"))
    print("captured", name, get("/health").decode().strip()[:80], flush=True)


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
FIELD, CONNECT = {"tv": ((960, 549), (960, 627)), "phone": ((540, 1290), (540, 1483))}[device]
click(*FIELD); time.sleep(1)
get("/type", text=os.environ["SERVER_URL"].strip()); time.sleep(1)
click(*CONNECT); time.sleep(8)
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
PROFILE_CLICK = {"tv": (846, 505), "phone": (330, 1150)}[device]
if device == "phone":
    route("profiles", 8); debug("phone-profiles")
click(*PROFILE_CLICK)
time.sleep(20)
debug("after-profile")

SCREENS_TV = None


def extra_screens(folder):
    """Screens a click cannot reach in one step: the actions drawer (long press on a card) and the player controls."""
    try:
        route("library:movie", 15)
        get("/hold", x=946, y=254); time.sleep(4); snap("actions", folder)
        key("back"); time.sleep(3)
    except SystemExit:
        print("actions not captured", flush=True)
    try:
        route("player:" + json.load(open(os.path.join(HERE, "..", "parity", "suite.json")))["performance"][0]["file"], 20)
        click(960, 540); time.sleep(3); snap("player-controls", folder, 30000)
    except SystemExit:
        print("player-controls not captured", flush=True)


def walk(folder, suffix):
    """The route-based screen walk (captures as <id><suffix>.png). Clicks only inside pages."""
    n = lambda s: s + suffix
    snap(n("home"), folder, 150000)
    if os.environ.get("POSTERDBG"):
        log_ = json.loads(get("/state")).get("dbglog", [])
        print("dbgsum", {k: sum(1 for x in log_ if x.startswith(k)) for k in ("cardart", "imgok", "imgerr")}, [x[:160] for x in log_ if x.startswith("imgerr")][:3], flush=True)
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
    route("settings", 8)
    if folder.endswith("dark") and device == "tv":
        # web's reference has Dark chosen explicitly (the colour theme row shows it selected); the Previewer starts on System
        click(394, 207); time.sleep(3); click(1645, 285); time.sleep(4)
    snap(n("settings"), folder)
    extra_screens(folder)


if device == "tv" and THEME in ("extra", "playback"):
    sys.exit(0)  # signed in on the Home screen: the suite (workflow step) takes over
if device == "tv" and THEME == "dpad":
    if not os.environ.get("KEYCHECK"):
        sys.exit(0)
    click(1044, 544); time.sleep(8); print("after card click", get("/state"), flush=True); debug("k-click-detail")
    key("back"); time.sleep(6); print("after back", get("/state"), flush=True)
    for i, k in enumerate(("right", "down", "left")):
        key(k); time.sleep(2); print("after", k, get("/state"), flush=True); debug("k-" + k)
    click(82, 466); time.sleep(6); print("after nav click", get("/state"), flush=True)
    key("down"); time.sleep(2); print("after nav down", get("/state"), flush=True)
    sys.exit(0)
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
    # phone: the web phone shell. Pages by route; the phone's own controls (the header filter button, a card tap or long press)
    # inside a page. Coordinates are px at density 480 (3 px per vp): the header's round buttons sit at the right, 16 vp in.
    folder = os.path.join(out, THEME)
    FILTER_BTN = (972, 100)
    CLOSE_DRAWER = (955, 135)
    VIEW_CHOICE = {"week": (540, 438), "month": (864, 438)}
    CARDS = ((258, 366), (258, 480), (258, 610), (258, 760))  # the first column of the two-column grid

    def open_filters(name):
        click(*FILTER_BTN); time.sleep(4); debug(name + "-filters-open")

    def open_detail(kind, name):
        route("library:" + kind, 15); settle()
        state = json.loads(get("/state"))
        if state.get("route") != "Library" or state.get("kind") != kind:
            raise Skip(f"library route did not settle: {state}")

        # The hosted phone Previewer renders a 1080x2340 surface at density 480.
        # The first landscape card is centred at (270, 360) in that surface.
        # Use its stable first-result position, then require the patched route
        # state to report Detail; pixel changes alone also count focus/animation.
        click(270, 360)
        deadline = time.time() + 15
        while time.time() < deadline:
            state = json.loads(get("/state"))
            if state.get("route") == "Detail":
                snap(name, folder, 100000)
                return
            time.sleep(0.5)
        debug(f"{name}-route-timeout")
        raise Skip(f"first {kind} card tap did not open Detail: {state}")

    def calendar_view(view):
        route("calendar", 18); settle()
        open_filters("calendar-" + view)
        click(*VIEW_CHOICE[view]); time.sleep(8)
        click(*CLOSE_DRAWER); time.sleep(3)
        snap("calendar-" + view, folder, 60000)

    for name, r, floor in (("home", "home", 100000), ("movies", "library:movie", 100000), ("series", "library:series", 100000),
                           ("music", "library:artist", 100000), ("calendar-agenda", "calendar", 60000), ("search", "search", 40000),
                           ("settings", "settings", 40000), ("profiles", "profiles", 40000)):
        guarded(name, lambda: (route(r, 40 if name == 'home' else 15), snap(name, folder, floor)))
    route("library:movie", 15); settle()
    open_filters("movies"); guarded("filters", lambda: snap("filters", folder, 40000)); click(*CLOSE_DRAWER); time.sleep(3)
    longclick(*CARDS[0]); time.sleep(5); debug("movies-actions-open"); guarded("actions", lambda: snap("actions", folder, 40000))
    guarded("calendar-week", lambda: calendar_view("week"))
    guarded("calendar-month", lambda: calendar_view("month"))
    guarded("film-detail", lambda: open_detail("movie", "film-detail"))
    guarded("series-detail", lambda: open_detail("series", "series-detail"))
    # extras beyond the 15: search with results, the period picker (calibration), the three settings panels
    def search_results():
        route("search", 12); click(540, 276); time.sleep(1); get("/type", text="the"); time.sleep(12); snap("search-results", folder, 60000)

    def settings_panel(name, y):
        route("profiles", 8); route("settings", 12); click(540, y); time.sleep(6); snap(name, folder, 40000)

    def period_picker():
        route("calendar", 18); click(270, 258); time.sleep(4); debug("calendar-period-picker"); snap("calendar-period", folder, 40000)

    guarded("search-results", search_results)
    guarded("calendar-period", period_picker)
    for nm, yy in (("settings-appearance", 300), ("settings-player", 510), ("settings-server", 720)):
        guarded(nm, lambda nm=nm, yy=yy: settings_panel(nm, yy))
    # the pinned 1080p file; the Previewer mocks AVPlayer, so this is the player page's chrome, never a playing picture
    guarded("player-controls", lambda: (route("player:b9a68b2c-8382-4c34-a6f0-c4dd58f55093", 20), snap("player-controls", folder, 30000)))
import datetime
json.dump({"branch": os.environ.get("BRANCH", "unknown"), "sha": os.environ.get("SHA", "unknown"), "pr": None,
           "theme": THEME, "missing": MISSING, "captured_at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")},
          open(os.path.join(out, "build.json"), "w"))
if MISSING:
    print("INCOMPLETE: missing required screens: " + ", ".join(MISSING), flush=True)
    sys.exit(2)
print("done")
