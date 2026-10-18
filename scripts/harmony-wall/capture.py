#!/usr/bin/env python3
"""Drives the Previewer through the bridge (harmony_vnc.py control port) and writes the parity captures.
Usage: capture.py <tv|phone> <out-dir> <previewer.log>   Environment: SERVER_URL, TEST_USERNAME, TEST_PASSWORD (approve_link.py).
Signs in fresh (link code logged by the app, approved as the Device Test account), picks the "Device Test" profile, then captures
dark and light. Aborts, writing nothing more, when a frame is too plain (an error or signed-out screen)."""
import hashlib, io, json, os, re, subprocess, sys, time, urllib.parse, urllib.request
from PIL import Image
from backend_preflight import check_backend
from capture_identity import guarded_frame, parse_identity_digest, wait_for_verified_identity
from screen_selection import (TV_SCREEN_IDS, parse_tv_screens, player_is_skipped, phone_core_only_requested,
                              phone_core_manifest_selection, player_fixture_selection)
from capture_diagnostics import (posters_stalled, tv_flat_card_blocks, home_recent_flat, save_rejected_frame, summarize_detail_events,
                                 summarize_detail_layout_events, summarize_detail_image_payload_events,
                                 analyze_episode_art_frame, episode_art_events_ready, decoded_art_is_accepted,
                                 series_focus_failure, previewer_focus_unavailable, write_detail_summary, confirm_detail_route_source,
                                 summarize_detail_load_events, phone_flat_card_rows, preview_focus_confirmed)

device, out, log = sys.argv[1], sys.argv[2], sys.argv[3]
THEME = sys.argv[4] if len(sys.argv) > 4 else "dark"  # phone: the Previewer starts in this colour mode (-cm), one job per theme. TV: the part (all, dpad, extra, playback)
TV_SCREENS_RAW = os.environ.get("TV_SCREENS", "all").strip()
SKIP_PLAYER_REQUESTED = os.environ.get("SKIP_PLAYER", "false").lower() == "true"
PHONE_CORE_ONLY_REQUESTED = os.environ.get("PHONE_CORE_ONLY", "false").lower() == "true"
PLAYER_FIXTURE_OVERRIDE = os.environ.get("HARMONY_PLAYER_FIXTURE_ID", "")
PLAYER_FIXTURE_SOURCE = None
CTL = "http://127.0.0.1:" + ("40117" if device == "phone" else "40017")
HERE = os.path.dirname(os.path.abspath(__file__))
os.makedirs(out, exist_ok=True)
IDENTITY_VERIFIED = False


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
    return Image.open(io.BytesIO(guarded_frame(IDENTITY_VERIFIED, lambda: get("/shot.png")))).convert("RGB")


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


class PostersStalled(Exception):
    """Not caught by snap's retries: waiting does not unstick the Previewer; the workflow restarts it (two retries, then the job fails)."""


MISSING = []


def abort(msg):
    print("ABORT: " + msg, flush=True)
    sys.exit(1)


try:
    TV_SELECTION = parse_tv_screens(TV_SCREENS_RAW) if device == "tv" else None
except ValueError as error:
    abort(str(error))
SKIP_PLAYER = player_is_skipped(TV_SELECTION, SKIP_PLAYER_REQUESTED)
try:
    PHONE_CORE_ONLY = phone_core_only_requested(device, PHONE_CORE_ONLY_REQUESTED)
except ValueError as error:
    abort(str(error))


def guarded(name, fn):
    """Phone walk: a screen whose guard fails is skipped and listed as missing; the others still publish."""
    try:
        fn()
    except (Skip, SystemExit) as e:
        if PREVIEW_TELEMETRY_FATAL:
            raise
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


PREVIEW_TELEMETRY_LOG_OFFSET = 0
PREVIEW_TELEMETRY_LOG_TAIL = b""
PREVIEW_TELEMETRY_FATAL = False



def assert_preview_telemetry_clean():
    global PREVIEW_TELEMETRY_LOG_OFFSET, PREVIEW_TELEMETRY_LOG_TAIL, PREVIEW_TELEMETRY_FATAL
    if PREVIEW_TELEMETRY_FATAL:
        raise SystemExit("preview telemetry transport failed; refusing this capture")
    marker = b"PLAYARR_PREVIEW_TELEMETRY_FAILED"
    try:
        with open(log, "rb") as preview_log:
            preview_log.seek(0, os.SEEK_END)
            size = preview_log.tell()
            if size < PREVIEW_TELEMETRY_LOG_OFFSET:
                PREVIEW_TELEMETRY_LOG_OFFSET = 0
                PREVIEW_TELEMETRY_LOG_TAIL = b""
            preview_log.seek(max(0, PREVIEW_TELEMETRY_LOG_OFFSET - len(marker) + 1))
            appended = preview_log.read()
            PREVIEW_TELEMETRY_LOG_OFFSET = size
            failed = marker in PREVIEW_TELEMETRY_LOG_TAIL + appended
            PREVIEW_TELEMETRY_LOG_TAIL = (PREVIEW_TELEMETRY_LOG_TAIL + appended)[-(len(marker) - 1):]
    except OSError as error:
        PREVIEW_TELEMETRY_FATAL = True
        raise SystemExit("could not verify preview telemetry log") from error
    if failed:
        PREVIEW_TELEMETRY_FATAL = True
        raise SystemExit("preview telemetry transport failed; refusing this capture")


def settle_preview_telemetry():
    # Cover the flush interval, all three bounded delivery attempts, and their retry delays.
    time.sleep(6)
    assert_preview_telemetry_clean()


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
    assert_preview_telemetry_clean()
    try:  # diagnostics: what the app reported at the moment of the frame (poster placeholders, network, image events)
        st = json.loads(get("/state"))
        print(f"[settle] {name} theme={THEME} img_pending={st.get('img_pending')} net_idle={st.get('net_idle')} dbg={ {k: v for k, v in (st.get('dbgcount') or {}).items() if not k[:4] in ('skel', 'img+', 'done', 'fail')} }", flush=True)
        skel = {}
        for k, v in (st.get('dbgcount') or {}).items():  # titles whose placeholder appeared more often than it went away
            if k.startswith('skel'):
                skel[k[5:]] = skel.get(k[5:], 0) + (v if k[4] == '+' else -v)
        dbgc = st.get('dbgcount') or {}
        shown = {k[4:] for k in dbgc if k.startswith('img+')}  # artwork reached the card but the image has not completed
        print(f"[settle] image set, not complete: {sorted(shown - {k[5:] for k in dbgc if k.startswith('done+')})} failed: {sorted(k[5:] for k in dbgc if k.startswith('fail+'))}", flush=True)
        print(f"[settle] still on placeholder: {sorted(t for t, n in skel.items() if n > 0)}", flush=True)
    except (ValueError, OSError, SystemExit):
        pass
    if b"[JsEngine Crash]" in open(log, "rb").read():
        debug("crash-" + name)
        raise RuntimeError("the Previewer's JS engine crashed: every later frame would be the frozen last one")
    if before_frame is not None:
        before_frame()
    img = png()
    debug('snap-' + name, img)
    if device == "tv" and not os.environ.get("CALIBRATE"):
        try:
            completes = (json.loads(get("/state")).get("dbgcount") or {}).get("poster-image-complete", 0)
        except (ValueError, OSError, SystemExit):
            completes = None
        blocks = tv_flat_card_blocks(img)
        if posters_stalled(name, completes, blocks, name == "home" and home_recent_flat(img)):
            img.save(os.path.join(out, "_rejected-" + name + ".png"))
            raise PostersStalled(f"{name}: image pipeline stalled (completed={completes}, placeholder blocks={blocks})")
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
    try:
        get("/state", resetdbg="1")  # the next frame's dump counts only what happens after this one
    except (OSError, SystemExit):
        pass
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
approval = subprocess.run([sys.executable, os.path.join(HERE, "approve_link.py"), code,
                           "--identity-control-url", CTL + "/state"], capture_output=True, text=True)
if approval.returncode != 0:
    abort("link code approval failed")
try:
    expected_identity_digest = parse_identity_digest(approval.stdout)
except ValueError as error:
    abort(str(error))

# 2. Pairing owns the device-token poll. Do not navigate away: Profiles is reached naturally after authenticated pairing.
def read_identity_state():
    return json.loads(get("/state"))


try:
    wait_for_verified_identity(read_identity_state)
except ValueError as error:
    abort(str(error))
IDENTITY_VERIFIED = True
print("signed-in account verified", flush=True)

# Seed only after the app identity is verified. This keeps a stale pairing from touching shared-account progress.
subprocess.run([sys.executable, os.path.join(HERE, "seed_progress.py")])  # best effort: Home's On deck matches the web reference
time.sleep(20)

# 3. Profiles only navigates to Home for the current account. Select the route directly after verification.
route("home", 20)

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
            route(configured_player_route(), 20)
            click(960, 540); time.sleep(3); snap("player-controls", folder, 30000)
        except SystemExit:
            print("player-controls not captured", flush=True)


def configured_player_route():
    global PLAYER_FIXTURE_SOURCE
    suite = json.load(open(os.path.join(HERE, "..", "parity", "suite.json")))
    try:
        file_path, PLAYER_FIXTURE_SOURCE = player_fixture_selection(suite, PLAYER_FIXTURE_OVERRIDE)
        return "player:" + file_path
    except ValueError as error:
        raise SystemExit(str(error)) from error


def focus_first_card(click_xy=None):
    """Web's reference frames are taken with the first card of the page focused (lifted, with the glow ring). The Previewer never delivers
    a focus event, so the preview patch turns PosterCard's state-driven focused look (ringOn) on for the first card on screen."""
    get("/state", resetfocused="1")
    get("/setroute", name="focus:pcard")
    assert_preview_telemetry_clean()
    for _ in range(10):
        time.sleep(1)
        assert_preview_telemetry_clean()
        if preview_focus_confirmed(json.loads(get("/state"))):
            time.sleep(2)
            return
    raise SystemExit("focus_first_card: no live card acknowledged focus")


def burst(folder, name, count=5):
    """Five frames about 150 ms apart (the web counterpart is capture-web-motion.mjs --profile tv)."""
    os.makedirs(folder, exist_ok=True)
    for i in range(count):
        png().save(os.path.join(folder, f"harmony-{name}-{i}.png"))
        time.sleep(0.15)


def motion_walk(folder):
    """Round 3 motion: Home scrolled down through the rails and back up, then along a rail, then Filters scrolled, by pointer swipes
    (the Previewer drops keys). Frames to capture/motion/<theme>/."""
    def swipe(x1, y1, x2, y2):
        get("/swipe", x1=x1, y1=y1, x2=x2, y2=y2); time.sleep(0.7)

    route("home", 30); focus_first_card(); burst(folder, "home-00-top")
    for i in range(1, 5):
        swipe(1300, 900, 1300, 500); burst(folder, f"home-{i:02d}-down")
    for i in range(1, 5):
        swipe(1300, 500, 1300, 900); burst(folder, f"home-{4 + i:02d}-up")
    for i in range(1, 4):
        swipe(1800, 930, 1000, 930); burst(folder, f"home-rail-{i:02d}-left")
    for i in range(1, 4):
        swipe(900, 930, 1700, 930); burst(folder, f"home-rail-{3 + i:02d}-right")
    route("library:movie", 15); click(1877, 187); time.sleep(5); burst(folder, "filters-00-open")
    for i in range(1, 4):
        swipe(1700, 800, 1700, 200); burst(folder, f"filters-{i:02d}-up")
    click(1850, 78); time.sleep(3)
    longclick(946, 254); time.sleep(5); burst(folder, "actions-00-open")
    for i in range(1, 4):
        swipe(1700, 800, 1700, 200); burst(folder, f"actions-{i:02d}-up")


def poster_walk(folder):
    """Round 3, poster mode: Settings > Appearance > Home screen artwork = Covers (touch works in the Previewer), then Home and a library in
    portrait covers at each artwork size; the settings are put back at the end. Frames go to capture/poster/<theme>/."""
    def choose(x, y):
        route("settings", 8); click(x, y); time.sleep(4)

    def covers_loaded():
        """The first Recently Added cover (top at y 933) is real art, not the flat placeholder: PostersStalled (the workflow restarts) when not."""
        img = png().convert("RGB")
        if max(high - low for low, high in img.crop((902, 960, 1050, 1070)).getextrema()) <= 40:
            raise PostersStalled("home-covers: Recently Added covers still on their placeholder")

    choose(1557, 500)  # Covers
    route("home", 30); settle(); covers_loaded(); focus_first_card(); snap("home-covers", folder, 100000)
    route("library:series", 15); focus_first_card(); snap("series-covers", folder, 100000)
    choose(1644, 715)  # Large
    route("home", 30); snap("home-covers-large", folder, 100000)
    choose(944, 715)  # Small
    route("home", 30); snap("home-covers-small", folder, 100000)
    choose(1294, 715)  # Medium
    choose(1032, 500)  # Thumbnails


def walk(folder, suffix):
    """The route-based screen walk (captures as <id><suffix>.png). Clicks only inside pages."""
    n = lambda s: s + suffix
    focus_first_card((1044, 544))
    snap(n("home"), folder, 150000)
    if os.environ.get("POSTERDBG"):
        events = json.loads(get("/state")).get("debug_events", [])
        print("dbgsum", {k: sum(1 for event in events if event.get("category") == k)
                          for k in ("home-card-artwork-ok", "poster-image-complete", "poster-image-error")}, flush=True)
    route("library:movie", 15); focus_first_card((946, 254)); snap(n("movies"), folder, 150000)
    click(1877, 187); time.sleep(5); snap(n("filters"), folder); click(1850, 78); time.sleep(3)
    click(946, 254); time.sleep(12); snap(n("film-detail"), folder); key("back"); time.sleep(3); key("back"); time.sleep(4)
    route("library:series", 15); focus_first_card((946, 254)); snap(n("series"), folder, 150000)
    click(946, 254); time.sleep(12); focus_first_card(); snap(n("series-detail"), folder); key("back"); time.sleep(3); key("back"); time.sleep(4)
    route("library:artist", 15); focus_first_card((946, 254)); snap(n("music"), folder, 150000)
    route("calendar", 18); snap(n("calendar-agenda"), folder)
    click(1877, 272); time.sleep(4); click(1740, 218); time.sleep(12); click(1850, 78); time.sleep(3); snap(n("calendar-week"), folder)
    click(1877, 272); time.sleep(4); click(1830, 218); time.sleep(12); click(1850, 78); time.sleep(3); snap(n("calendar-month"), folder)
    route("search", 12); snap(n("search"), folder)
    route("settings", 8)
    if device == "tv":
        # web's reference has the theme chosen explicitly (the colour theme row shows Dark or Light selected); the Previewer starts on System
        click(394, 207); time.sleep(3); click(1645 if folder.endswith("dark") else 1295, 285); time.sleep(4)
    snap(n("settings"), folder)
    extra_screens(folder)
    if os.environ.get("MOTION") == "true" and device == "tv":
        motion_walk(os.path.join(out, "motion", "dark" if folder.endswith("dark") else "light"))
    if os.environ.get("POSTER_MODE") == "true" and device == "tv":
        try:
            poster_walk(os.path.join(out, "poster", "dark" if folder.endswith("dark") else "light"))
        except PostersStalled as stalled:  # an extra, not a published screen: the main captures are already taken, so keep them
            print("poster walk skipped:", stalled, flush=True)


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

                deadline = time.time() + 40  # the bridge decodes uploads one by one: 24 episode images take ~20 s on a CI runner
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

            if name == "series-detail":  # which guard of the target-visibility report stopped it (preview-only counters)
                print("series-detail guard", {k: v for k, v in (route_state().get("dbgcount") or {}).items() if k.startswith(("tgt-", "len-"))}, flush=True)
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
                if focus_failure in ("focus-request-not-accepted", "focus-not-target") and previewer_focus_unavailable(layout):
                    print("series-detail: the Previewer has no focus controller (requestFocus threw); focus is not asserted here", flush=True)
                    focus_failure = None
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
    folder = os.path.join(out, "light" if THEME == "light" else "dark")
    if TV_SELECTION is None:
        route("profiles", 6); snap("profiles", folder)
        route("home", 20)
        walk(folder, "")
        if THEME == "all":  # the dark and light jobs each start the Previewer in their own colour mode (-cm)
            # light: Settings theme toggle (coordinates of the Mac scripts), then the same walk
            route("settings", 8); click(394, 207); time.sleep(3); click(1295, 285); time.sleep(4)
            route("profiles", 6); snap("profiles", os.path.join(out, "light"))
            route("home", 20)
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
                    # The app fetches the episode stills one after another; a stalled request (the dark job's Previewer under load logs
                    # curl code 28 timeouts) leaves it waiting for good, so open the page again every 30 s to start a fresh fetch.
                    art_end = time.time() + 150
                    next_reopen = time.time() + 30
                    clean = 0
                    # Two clean checks in a row, 5 s apart: the page scrolls to the next-up episode after it opens, so a single early
                    # check can see art that is still above the fold while the cards the frame will show are grey (light, 2026-10-15).
                    while clean < 2 and time.time() < art_end:
                        time.sleep(5)
                        clean = clean + 1 if phone_flat_card_rows(png(), top_px=700, bottom_px=260) == 0 else 0
                        if clean == 0 and time.time() >= next_reopen:
                            route("home", 6); route("detail:" + work_id, 8)
                            next_reopen = time.time() + 30
                    if clean < 2:
                        debug(name + "-placeholder-art")
                        raise Skip(f"{name}: the episode cards still show grey placeholders after 120 s")
                # the web refs are taken at page top; the app scrolls to the next-up episode, so drag back up before the frame
                for _ in range(3):
                    get("/swipe", x1=540, y1=500, x2=540, y2=2200, steps=12, ms=300); time.sleep(1.5)
                time.sleep(2)
                snap(name, folder, 100000)
                if kind == "series":  # the saved frame itself must show art (the page may have moved since the last check)
                    saved = os.path.join(folder, name + ".png")
                    if phone_flat_card_rows(Image.open(saved)) > 0:
                        os.replace(saved, os.path.join(out, "_debug", name + "-placeholder-saved.png"))
                        raise Skip(f"{name}: the saved frame shows grey placeholder cards")
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
        if name == "home":  # other workers share the account: re-seed immediately before capture for the pinned fixture item
            subprocess.run([sys.executable, os.path.join(HERE, "seed_progress.py")])
        guarded(name, lambda: (route(r, 40 if name == 'home' else 15), focus_first_card() if name in ('home', 'movies', 'series', 'music') else None, snap(name, folder, floor)))
    route("library:movie", 15); settle()
    open_filters("movies"); guarded("filters", lambda: snap("filters", folder, 40000)); click(*CLOSE_DRAWER); time.sleep(3)
    longclick(*CARDS[0]); time.sleep(5); debug("movies-actions-open"); guarded("actions", lambda: snap("actions", folder, 40000))
    guarded("calendar-week", lambda: calendar_view("week"))
    guarded("calendar-month", lambda: calendar_view("month"))
    guarded("film-detail", lambda: open_detail("movie", "film-detail"))
    guarded("series-detail", lambda: open_detail("series", "series-detail"))

    def write_phone_core_manifest():
        settle_preview_telemetry()
        suite_screens = json.load(open(os.path.join(HERE, "..", "parity", "suite.json")))['screens']
        requested = [screen["id"] for screen in suite_screens]
        captured = [name for name in requested if os.path.isfile(os.path.join(folder, name + ".png"))]
        selection, absent = phone_core_manifest_selection(requested, captured, SKIP_PLAYER)
        missing = list(dict.fromkeys(MISSING + absent))
        manifest = {"branch": os.environ.get("BRANCH", "unknown"), "sha": os.environ.get("SHA", "unknown"), "pr": None,
                    "theme": THEME, "missing": missing, "captured_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    "screen_selection": {**selection, "captured": {THEME: selection["captured"]}}}
        if PLAYER_FIXTURE_SOURCE is not None:
            manifest["screen_selection"]["player_fixture_source"] = PLAYER_FIXTURE_SOURCE
        json.dump(manifest, open(os.path.join(out, "build.json"), "w"))
        if missing:
            print("INCOMPLETE: missing required screens: " + ", ".join(missing), flush=True)
            return False
        print("done", flush=True)
        return True

    if PHONE_CORE_ONLY:
        # The player chrome is the fifteenth core screen unless explicitly skipped for a diagnostic capture.
        if not SKIP_PLAYER:
            guarded("player-controls", lambda: (route(configured_player_route(), 20), snap("player-controls", folder, 30000)))
        sys.exit(0 if write_phone_core_manifest() else 2)

    # extras beyond the 15: search with results, the period picker (calibration), the three settings panels
    def search_results():
        route("search", 12); click(540, 276); time.sleep(1); get("/type", text="the"); time.sleep(12); snap("search-results", folder, 60000)

    def settings_panel(name, y):
        route("profiles", 8); route("settings", 12); click(540, y); time.sleep(6); snap(name, folder, 40000)

    def period_picker():
        route("calendar", 18); click(270, 258); time.sleep(4); debug("calendar-period-picker"); snap("calendar-period", folder, 40000)

    guarded("search-results", search_results)
    guarded("calendar-period", period_picker)
    for nm, yy in (("settings-appearance", 347), ("settings-player", 1139), ("settings-server", 1403)):
        guarded(nm, lambda nm=nm, yy=yy: settings_panel(nm, yy))

    # Round 3 poster mode: Settings > Appearance > Home screen artwork = Covers, then each artwork size, and Home in each (the setting
    # lives in the Previewer's in-memory preferences, so it takes effect for the Home routes that follow in this run). Buttons at 3 px per vp.
    COVERS_BTN, SMALL_BTN, LARGE_BTN, MEDIUM_BTN, THUMBS_BTN = (792, 1134), (204, 1830), (876, 1830), (540, 1830), (288, 1134)

    def home_with(name, taps):
        route("profiles", 8); route("settings", 12); click(540, 300); time.sleep(6)
        for x, y in taps:
            click(x, y); time.sleep(2)
        route("home", 40); snap(name, folder, 100000)

    # Round 3 motion: swipes through Home, a rail and the drawers, a 5-frame burst (about 150 ms apart) after each step, into _debug/motion-*.png.
    def burst(name, n=5, gap=0.15):
        for i in range(n):
            debug("motion-%s-%d" % (name, i), png()); time.sleep(gap)

    def swipe(x1, y1, x2, y2):
        get("/swipe", x1=x1, y1=y1, x2=x2, y2=y2, steps=12, ms=300)

    def motion_home():
        route("home", 40); burst("home-00-top")
        for i in range(1, 5):
            swipe(540, 1900, 540, 700); burst("home-%02d-down" % i)
        for i in range(1, 5):
            swipe(540, 700, 540, 1900); burst("home-%02d-up" % (4 + i))
        for i in range(1, 4):
            swipe(990, 1180, 90, 1180); burst("home-rail-%02d-left" % i)
        for i in range(1, 4):
            swipe(90, 1180, 990, 1180); burst("home-rail-%02d-right" % (3 + i))

    def motion_drawers():
        route("library:movie", 15); settle()
        open_filters("motion"); burst("filters-00-open")
        for i in range(1, 4):
            swipe(540, 1900, 540, 500); burst("filters-%02d-up" % i)
        click(*CLOSE_DRAWER); time.sleep(3)
        longclick(*CARDS[0]); time.sleep(5); burst("actions-00-open")
        for i in range(1, 4):
            swipe(540, 1900, 540, 500); burst("actions-%02d-up" % i)

    guarded("motion-home", motion_home)
    guarded("motion-drawers", motion_drawers)
    guarded("home-covers", lambda: home_with("home-covers", [COVERS_BTN]))
    guarded("home-covers-small", lambda: home_with("home-covers-small", [SMALL_BTN]))
    guarded("home-covers-large", lambda: home_with("home-covers-large", [LARGE_BTN]))
    guarded("home-thumbs-large", lambda: home_with("home-thumbs-large", [THUMBS_BTN]))

    # Library in Covers mode at each artwork size: set the size in Settings, open Library > Filters, choose the Cover view, close, capture.
    COVER_VIEW_BTN = (868, 450)

    def library_covers(name, size_btn):
        route("profiles", 8); route("settings", 12); click(540, 300); time.sleep(6)
        click(*size_btn); time.sleep(2)
        route("library:movie", 15); settle()
        open_filters(name); time.sleep(3); click(*COVER_VIEW_BTN); time.sleep(3); click(*COVER_VIEW_BTN); time.sleep(3); click(*CLOSE_DRAWER); time.sleep(5); settle()
        snap(name, folder, 100000)

    # The first Library visit may ignore the Cover tap, so medium goes first and the saved view carries forward.
    for nm, btn in (("library-covers-medium", MEDIUM_BTN), ("library-covers-small", SMALL_BTN), ("library-covers-large", LARGE_BTN)):
        guarded(nm, lambda nm=nm, btn=btn: library_covers(nm, btn))
    # the pinned 1080p file; the Previewer mocks AVPlayer, so this is the player page's chrome, never a playing picture
    guarded("player-controls", lambda: (route(configured_player_route(), 20), snap("player-controls", folder, 30000)))
import datetime
manifest = {"branch": os.environ.get("BRANCH", "unknown"), "sha": os.environ.get("SHA", "unknown"), "pr": None,
            "theme": THEME, "missing": MISSING, "captured_at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")}
if PLAYER_FIXTURE_SOURCE is not None:
    manifest["player_fixture_source"] = PLAYER_FIXTURE_SOURCE
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
settle_preview_telemetry()
json.dump(manifest, open(os.path.join(out, "build.json"), "w"))
if MISSING:
    print("INCOMPLETE: missing required screens: " + ", ".join(MISSING), flush=True)
    sys.exit(2)
print("done")
