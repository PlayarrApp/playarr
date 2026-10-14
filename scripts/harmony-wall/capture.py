#!/usr/bin/env python3
"""Drives the Previewer through the bridge (harmony_vnc.py control port) and writes the parity captures.
Usage: capture.py <tv|phone> <out-dir> <previewer.log>   Environment: SERVER_URL, TEST_USERNAME, TEST_PASSWORD (approve_link.py).
Signs in fresh (link code logged by the app, approved as the Device Test account), picks the "Device Test" profile, then captures
dark and light. Aborts, writing nothing more, when a frame is too plain (an error or signed-out screen)."""
import hashlib, io, json, os, re, subprocess, sys, time, urllib.parse, urllib.request
from PIL import Image
from backend_preflight import check_backend
from screen_selection import TV_SCREEN_IDS, parse_tv_screens, player_is_skipped
from capture_diagnostics import (save_rejected_frame, summarize_detail_events,
                                 summarize_detail_layout_events, summarize_detail_image_payload_events,
                                 analyze_episode_art_frame, episode_art_events_ready, decoded_art_is_accepted,
                                 series_focus_failure, write_detail_summary, confirm_detail_route_source,
                                 summarize_detail_load_events, phone_flat_card_rows)

device, out, log = sys.argv[1], sys.argv[2], sys.argv[3]
THEME = sys.argv[4] if len(sys.argv) > 4 else "dark"  # phone: the Previewer starts in this colour mode (-cm), one job per theme. TV: the part (all, dpad, extra, playback)
TV_SCREENS_RAW = os.environ.get("TV_SCREENS", "all").strip()
SKIP_PLAYER_REQUESTED = os.environ.get("SKIP_PLAYER", "false").lower() == "true"
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


try:
    TV_SELECTION = parse_tv_screens(TV_SCREENS_RAW) if device == "tv" else None
except ValueError as error:
    abort(str(error))
SKIP_PLAYER = player_is_skipped(TV_SELECTION, SKIP_PLAYER_REQUESTED)


def guarded(name, fn):
    """Phone walk: a screen whose guard fails is skipped and listed as missing; the others still publish."""
    try:
        fn()
    except (Skip, SystemExit) as e:
        print(f"SKIP {name}: {e}", flush=True)
        MISSING.append(name)


def images_pending():
    """Poster cards still on their placeholder plus one while any API or artwork request is in flight (both app-reported; the
    request count catches cards a lazy list has not built yet); 0 when the build has never reported."""
    try:
        st = json.loads(get("/state"))
        return st.get("img_pending", 0) + (1 if st.get("net_idle") is False else 0)
    except (ValueError, OSError, SystemExit):
        return 0


def settle(limit=45, image_limit=90):
    """Wait until the frame stops changing (posters and lists arrive after the route does): two equal polls 4 s apart, and then until
    the app reports no poster still on its placeholder (bounded: art that never loads is a result to see, not to wait on forever)."""
    last, end = None, time.time() + limit
    while time.time() < end:
        cur = png().tobytes()
        if cur == last:
            break
        last = cur
        time.sleep(4)
    image_end = time.time() + image_limit
    while images_pending() > 0 and time.time() < image_end:
        time.sleep(3)
        last = None
    if last is None:  # something arrived while waiting: let the frame settle once more
        settle(limit=20, image_limit=0)


SEEN = {}


def snap(name, folder, floor=60000, frame_observer=None, before_frame=None):
    for attempt in range(3 if device == "tv" else 1):
        try:
            snap_checked(name, folder, floor, frame_observer=frame_observer, before_frame=before_frame)
            return
        except SystemExit:
            if device == "phone":
                raise Skip(name)
            if attempt == 2 or device != "tv":
                raise
            print(f"{name}: retrying in 25 s (the list may still be loading)", flush=True)
            time.sleep(25)


def snap_checked(name, folder, floor, frame_observer=None, before_frame=None):
    settle()
    if b"[JsEngine Crash]" in open(log, "rb").read():
        debug("crash-" + name)
        raise RuntimeError("the Previewer's JS engine crashed: every later frame would be the frozen last one")
    if before_frame is not None:
        before_frame()
    img = png()
    debug('snap-' + name, img)
    if frame_observer is not None:
        frame_observer(img)
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


def debug(name, image=None):
    d = os.path.join(out, "_debug")
    os.makedirs(d, exist_ok=True)
    (image if image is not None else png()).save(os.path.join(d, name + ".png"))


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
    if SKIP_PLAYER:
        print("player-controls skipped by request", flush=True)
    else:
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
        events = json.loads(get("/state")).get("debug_events", [])
        print("dbgsum", {k: sum(1 for event in events if event.get("category") == k)
                          for k in ("home-card-artwork-ok", "poster-image-complete", "poster-image-error")}, flush=True)
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
    if TV_SELECTION is not None:
        suite_screens = json.load(open(os.path.join(HERE, "..", "parity", "suite.json")))["screens"]
        detail_sources = {}
        decoded_art = {"dark": False, "light": False}
        series_detail_acceptance = {"dark": False, "light": False}

        def route_state():
            return json.loads(get("/state"))

        def capture_selected_detail(name, folder, theme):
            episode_art_result = {}
            final_snapshot = {}
            remote_input_sent = False  # The selected Detail route is opened through the route mailbox.

            def capture_final_state():
                final_snapshot["state"] = route_state()
                final_snapshot["remote_input_sent_before_focus_assertion"] = remote_input_sent

            def detail_load_summary(state, cursor, work_id, generation):
                return summarize_detail_load_events(
                    state.get("debug_events", []), sequence_after=cursor, work_id=work_id,
                    generation=generation, remote_input_sent_before_focus_assertion=remote_input_sent)
            # A backend that is briefly unready is retried (as snap retries a slow list) before the screen is skipped.
            for preflight_attempt in range(3):
                preflight = check_backend(os.environ.get("SERVER_URL", ""))
                if preflight["ready"] or preflight_attempt == 2:
                    break
                print(f"{name}: backend not ready ({preflight['failure']}), retrying in 20 s", flush=True)
                time.sleep(20)
            with open(os.path.join(out, "backend-preflight-" + theme + ".json"), "w", encoding="utf-8") as result_file:
                json.dump({"theme": theme, **preflight}, result_file)
            if not preflight["ready"]:
                raise Skip("backend-preflight-" + str(preflight["failure"]))
            spec = next((screen for screen in suite_screens if screen.get("id") == name), None)
            prefix = "/movies/" if name == "film-detail" else "/series/"
            opened = spec.get("open", "") if spec is not None else ""
            if not opened.startswith(prefix):
                raise Skip(f"shared suite has no pinned route for {name}")
            work_id = opened[len(prefix):]
            if not re.fullmatch(r"[0-9a-fA-F-]{36}", work_id):
                raise Skip(f"shared suite has an invalid pinned work ID for {name}")

            before_route = route_state()
            cursor = before_route.get("debug_sequence", 0)
            started_at = time.monotonic()
            route("detail:" + work_id, 5)
            deadline = time.time() + 15
            state = {}
            while time.time() < deadline:
                state = route_state()
                if state.get("route") == "Detail" and state.get("work_id") == work_id:
                    break
                time.sleep(0.5)
            if not confirm_detail_route_source(detail_sources, name, state, work_id):
                if name == "series-detail":
                    capture_final_state()
                    state = final_snapshot["state"]
                    rejected = png()
                    frame_path = save_rejected_frame(rejected, out, theme, name)
                    stages = summarize_detail_events(state.get("debug_events", []), sequence_after=cursor,
                                                     work_id=work_id, generation=state.get("route_generation", 0),
                                                     started_at=started_at)
                    layout = summarize_detail_layout_events(state.get("debug_events", []), sequence_after=cursor,
                                                            work_id=work_id, generation=state.get("route_generation", 0),
                                                            started_at=started_at)
                    payload_metrics = summarize_detail_image_payload_events(
                        state.get("debug_events", []), sequence_after=cursor, work_id=work_id,
                        generation=state.get("route_generation", 0))
                    write_detail_summary(out, theme=theme, accepted=False, failure="route-not-settled",
                                         frame_path=frame_path, stages=stages, layout=layout,
                                         payload_metrics=payload_metrics,
                                         detail_load=detail_load_summary(state, cursor, work_id,
                                                                         state.get("route_generation", 0)))
                raise Skip(f"pinned route did not settle for {name}")

            if name == "series-detail":
                generation = state.get("route_generation", 0)
                if generation <= 0:
                    raise Skip("pinned detail route has no preview generation")
                completion_seen = False

                def inspect_episode_art(frame, failure_override=None):
                    current = final_snapshot.get("state") or route_state()
                    metrics = analyze_episode_art_frame(
                        frame, events=current.get("debug_events", []), sequence_after=cursor,
                        work_id=work_id, generation=generation)
                    episode_art_result["metrics"] = metrics
                    if metrics["status"] == "ok":
                        return
                    frame_path = save_rejected_frame(frame, out, theme, name)
                    stages = summarize_detail_events(current.get("debug_events", []), sequence_after=cursor,
                                                     work_id=work_id, generation=generation,
                                                     started_at=started_at)
                    layout = summarize_detail_layout_events(current.get("debug_events", []), sequence_after=cursor,
                                                            work_id=work_id, generation=generation,
                                                            started_at=started_at)
                    payload_metrics = summarize_detail_image_payload_events(
                        current.get("debug_events", []), sequence_after=cursor, work_id=work_id,
                        generation=generation)
                    failure = failure_override if failure_override is not None else metrics["status"]
                    write_detail_summary(out, theme=theme, accepted=False, failure=failure,
                                         frame_path=frame_path, stages=stages, layout=layout,
                                         payload_metrics=payload_metrics, episode_art=metrics,
                                         detail_load=detail_load_summary(current, cursor, work_id, generation))
                    raise Skip(failure)

                deadline = time.time() + 12
                while time.time() < deadline:
                    current = route_state()
                    if (current.get("route") != "Detail" or current.get("work_id") != work_id
                            or current.get("route_generation") != generation):
                        if name == "series-detail":
                            capture_final_state()
                            current = final_snapshot["state"]
                            frame_path = save_rejected_frame(png(), out, theme, name)
                            stages = summarize_detail_events(current.get("debug_events", []), sequence_after=cursor,
                                                             work_id=work_id, generation=generation,
                                                             started_at=started_at)
                            layout = summarize_detail_layout_events(current.get("debug_events", []), sequence_after=cursor,
                                                                    work_id=work_id, generation=generation,
                                                                    started_at=started_at)
                            payload_metrics = summarize_detail_image_payload_events(
                                current.get("debug_events", []), sequence_after=cursor, work_id=work_id,
                                generation=generation)
                            write_detail_summary(out, theme=theme, accepted=False, failure="route-changed",
                                                 frame_path=frame_path, stages=stages, layout=layout,
                                                 payload_metrics=payload_metrics,
                                                 detail_load=detail_load_summary(current, cursor, work_id, generation))
                        raise Skip("pinned detail route changed while waiting for row artwork")
                    events = current.get("debug_events", [])
                    stages = summarize_detail_events(events, sequence_after=cursor, work_id=work_id,
                                                     generation=generation, started_at=started_at)
                    layout = summarize_detail_layout_events(events, sequence_after=cursor, work_id=work_id,
                                                            generation=generation, started_at=started_at)
                    payload_metrics = summarize_detail_image_payload_events(
                        events, sequence_after=cursor, work_id=work_id, generation=generation)
                    if episode_art_events_ready(events, sequence_after=cursor, work_id=work_id,
                                                generation=generation, frame_size=(1920, 1080)):
                        completion_seen = True
                        break
                    time.sleep(0.25)
                if not completion_seen:
                    capture_final_state()
                    frame = png()
                    inspect_episode_art(frame, failure_override="row-artwork-timeout")
                    # A callback can arrive after the polling deadline but before this final frame.
                    # inspect_episode_art raises on failure, so reaching here means the last frame passed.
                    completion_seen = True

            try:
                snap(name, folder, 100000,
                     frame_observer=inspect_episode_art if name == "series-detail" else None,
                     before_frame=capture_final_state if name == "series-detail" else None)
            except SystemExit:
                if name == "series-detail":
                    capture_final_state()
                    current = final_snapshot["state"]
                    frame_path = save_rejected_frame(png(), out, theme, name)
                    stages = summarize_detail_events(current.get("debug_events", []), sequence_after=cursor,
                                                     work_id=work_id, generation=generation, started_at=started_at)
                    layout = summarize_detail_layout_events(current.get("debug_events", []), sequence_after=cursor,
                                                            work_id=work_id, generation=generation,
                                                            started_at=started_at)
                    payload_metrics = summarize_detail_image_payload_events(
                        current.get("debug_events", []), sequence_after=cursor, work_id=work_id,
                        generation=generation)
                    write_detail_summary(out, theme=theme, accepted=False, failure="frame-rejected",
                                         frame_path=frame_path, stages=stages, layout=layout,
                                         payload_metrics=payload_metrics,
                                         episode_art=episode_art_result.get("metrics"),
                                         detail_load=detail_load_summary(current, cursor, work_id, generation))
                raise
            if name == "series-detail":
                decoded_art[theme] = decoded_art_is_accepted(
                    completion_seen, episode_art_result.get("metrics"))
                current = route_state()
                if name == "series-detail" and final_snapshot.get("state") is not None:
                    current = final_snapshot["state"]
                stages = summarize_detail_events(current.get("debug_events", []), sequence_after=cursor,
                                                 work_id=work_id, generation=generation, started_at=started_at)
                layout = summarize_detail_layout_events(current.get("debug_events", []), sequence_after=cursor,
                                                        work_id=work_id, generation=generation,
                                                        started_at=started_at)
                payload_metrics = summarize_detail_image_payload_events(
                    current.get("debug_events", []), sequence_after=cursor, work_id=work_id,
                    generation=generation)
                focus_failure = series_focus_failure(layout, episode_art_result.get("metrics"))
                accepted = decoded_art[theme] and focus_failure is None
                failure = focus_failure if focus_failure is not None else (
                    None if decoded_art[theme] else "episode-art-not-accepted")
                series_detail_acceptance[theme] = accepted
                write_detail_summary(out, theme=theme, accepted=accepted, failure=failure,
                                     frame_path=os.path.relpath(os.path.join(folder, name + ".png"), out), stages=stages,
                                     layout=layout, payload_metrics=payload_metrics,
                                     episode_art=episode_art_result.get("metrics"),
                                     detail_load=detail_load_summary(current, cursor, work_id, generation))
                if not accepted:
                    raise Skip(failure or "series-detail-not-accepted")

        def capture_selected(folder, theme):
            for name in TV_SELECTION:
                def capture_one():
                    if name == "home":
                        route("home", 8)
                        snap(name, folder, 150000)
                    elif name == "movies":
                        route("library:movie", 15)
                        snap(name, folder, 150000)
                    else:
                        capture_selected_detail(name, folder, theme)
                guarded(name, capture_one)

        capture_selected(os.path.join(out, "dark"), "dark")
        route("settings", 8); click(394, 207); time.sleep(3); click(1295, 285); time.sleep(4)
        capture_selected(os.path.join(out, "light"), "light")
        for name in TV_SELECTION:
            if name in ("film-detail", "series-detail") and name not in detail_sources:
                detail_sources[name] = {"route": "Detail", "source": "suite.json:open", "route_confirmed": False}
    else:
        detail_sources = None
        decoded_art = None
    folder = os.path.join(out, "dark")
    if TV_SELECTION is None:
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
        screens = json.load(open(os.path.join(HERE, "..", "parity", "suite.json")))['screens']
        spec = next((s for s in screens if s.get("id") == name), None)
        opened = spec.get("open", "") if spec is not None else ""
        prefix = "/" + ("movies" if kind == "movie" else "series") + "/"
        if not opened.startswith(prefix):
            raise Skip(f"shared suite has no pinned {kind} detail route for {name}")
        work_id = opened[len(prefix):]
        if not re.fullmatch(r"[0-9a-fA-F-]{36}", work_id):
            raise Skip(f"shared suite has an invalid pinned work id for {name}")

        # Deep-link to the shared suite's pinned work id and verify that the
        # Previewer route state reports that same id before saving the frame.
        route("detail:" + work_id, 5)
        deadline = time.time() + 15
        while time.time() < deadline:
            state = json.loads(get("/state"))
            if state.get("route") == "Detail" and state.get("work_id") == work_id:
                if kind == "series":
                    # the episode cards must show art: a frame with grey placeholder cards is waited on, then refused
                    art_end = time.time() + 120
                    while phone_flat_card_rows(png()) > 0 and time.time() < art_end:
                        time.sleep(5)
                    if phone_flat_card_rows(png()) > 0:
                        debug(name + "-placeholder-art")
                        raise Skip(f"{name}: the episode cards still show grey placeholders after 120 s")
                snap(name, folder, 100000)
                return
            time.sleep(0.5)
        debug(f"{name}-route-timeout")
        raise Skip(f"pinned {kind} detail route did not settle for {name}: {state}")

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
manifest = {"branch": os.environ.get("BRANCH", "unknown"), "sha": os.environ.get("SHA", "unknown"), "pr": None,
            "theme": THEME, "missing": MISSING, "captured_at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")}
if device == "tv" and (TV_SELECTION is not None or SKIP_PLAYER):
    suite_screens = json.load(open(os.path.join(HERE, "..", "parity", "suite.json")))["screens"]
    requested = TV_SELECTION if TV_SELECTION is not None else [
        screen["id"] for screen in suite_screens if not (SKIP_PLAYER and screen["id"] == "player-controls")
    ]
    manifest["missing"] = list(dict.fromkeys(MISSING))
    manifest["screen_selection"] = {
        "mode": "selected" if TV_SELECTION is not None else "all",
        "skip_player": SKIP_PLAYER,
        "requested": requested,
        "captured": {
            theme: [name for name in requested if os.path.isfile(os.path.join(out, theme, name + ".png"))]
            for theme in ("dark", "light")
        },
    }
    if TV_SELECTION is not None:
        manifest["screen_selection"]["pinned_detail_sources"] = detail_sources
        manifest["screen_selection"]["decoded_art"] = decoded_art
        manifest["screen_selection"]["series_detail_accepted"] = series_detail_acceptance
json.dump(manifest, open(os.path.join(out, "build.json"), "w"))
if MISSING:
    print("INCOMPLETE: missing required screens: " + ", ".join(MISSING), flush=True)
    sys.exit(2)
print("done")
