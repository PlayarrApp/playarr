#!/usr/bin/env python3
"""Playarr VIDAA remote driver (Hisense VIDAA MQTT-over-TLS remote service).

Run with the venv interpreter:  <venv>/bin/python -I vidaa.py <command>
The TV address comes from $VIDAA_HOST. Secrets live in ~/.secrets as
PLAYARR_VIDAA_* and are never printed.

Commands
  discover              read-only: UPnP descriptor (model hints, protocol)
  state                 read-only: current TV state (retained broadcast)
  apps                  read-only: installed app list
  volume get            read-only: current volume
  key <KEY_*> [...]     press keys (foreground guard applies)
  launch <app> [--allow-any]   launch by name/appId from the app list
  pair start            trigger the PIN dialog ONCE; daemon waits for the PIN
  pair pin <1234>       hand the PIN to the waiting daemon
  pair status           show pairing state
  open-debug [--variant app|webapp|noid]  open our own debug-mirror page in the TV (receiver must run)
  screen [--out F]      save the latest mirrored frame (JPEG) plus its JSON metadata
  focus [--text]        focused element, viewport, route (and visible text) of the latest frame
  events [seconds]      log broadcast events (state, volume) as JSON lines

Safety: key presses abort unless the foreground app matches
$VIDAA_FOREGROUND_MATCH (default "playarr"). KEY_POWER and volume
changes are refused outright. No install/uninstall/settings actions exist.
"""
import warnings
warnings.filterwarnings("ignore")
import argparse
import base64
import hashlib
import json
import os
import re
import secrets as pysecrets
import shutil
import ssl
import sys
import tempfile
import threading
import time
import urllib.request
from pathlib import Path

import paho.mqtt.client as mqtt

PORT = 36669
PATTERN = "38D65DC30F45109A369A86FCE866A85B"
SUFFIX_MODERN = "h!i@s#$v%i^d&a*a"
XOR_MASK = 0x5698_1477_2B03_A968
SECRETS = Path.home() / ".secrets"
STATE_DIR = Path(os.environ.get("VIDAA_STATE_DIR", Path(__file__).resolve().parent / ".state"))
BLOCKED_KEYS = {"KEY_POWER", "KEY_VOLUMEUP", "KEY_VOLUMEDOWN", "KEY_MUTE", "KEY_MUTE_LONG_PRESS",
                "KEY_VOICEUP", "KEY_VOICEDOWN"}
P = "PLAYARR_VIDAA_"


# ---------- secrets (values are never printed) ----------
def _parse():
    out = {}
    for line in SECRETS.read_text().splitlines():
        m = re.match(r"^([A-Z0-9_]+)=(.*)$", line)
        if m:
            v = m.group(2)
            if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
                v = v[1:-1]
            out[m.group(1)] = v
    return out


def sget(name):
    return _parse().get(P + name)


def sset(**kv):
    """Back up, then set/replace PLAYARR_VIDAA_<name>=value lines (mode 0600)."""
    bak = SECRETS.with_name(f".secrets.bak.{int(time.time() * 1000)}")
    shutil.copy2(SECRETS, bak)
    os.chmod(bak, 0o600)
    lines = SECRETS.read_text().splitlines()
    for name, val in kv.items():
        key = P + name
        new = f"{key}={val}"
        for i, l in enumerate(lines):
            if l.startswith(key + "="):
                lines[i] = new
                break
        else:
            lines.append(new)
    tmp = SECRETS.with_name(".secrets.tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write("\n".join(lines) + "\n")
    os.replace(tmp, SECRETS)
    os.chmod(SECRETS, 0o600)


def b64d(s):
    return base64.b64decode(s)


# ---------- credentials ----------
def md5u(s):
    return hashlib.md5(s.encode()).hexdigest().upper()


def make_creds(uuid, ts=None):
    ts = ts or int(time.time())
    cid = f"{uuid}$his${md5u(PATTERN + '$' + uuid)[:6]}_vidaacommon_001"
    user = f"his${ts ^ XOR_MASK}"
    rem = sum(int(d) for d in str(ts)) % 10
    pw = md5u(f"{ts}${md5u(f'his{rem}{SUFFIX_MODERN}')[:6]}")
    return cid, user, pw


def host():
    h = os.environ.get("VIDAA_HOST")
    if not h:
        sys.exit("VIDAA_HOST is not set")
    return h


def discover():
    for port in (38400, 18400):
        try:
            with urllib.request.urlopen(f"http://{host()}:{port}/MediaServer/rendererdevicedesc.xml", timeout=4) as r:
                xml = r.read().decode()
            info = {k: v for k, v in re.findall(r"^(\w+)=(.*?)\r?$", xml, re.M)
                    if k in ("transport_protocol", "brand", "vidaa_support", "region", "platform", "voice")}
            fn = re.search(r"<friendlyName>(.*?)</friendlyName>", xml)
            info["friendlyName"] = fn.group(1) if fn else None
            return info
        except Exception:
            continue
    return {}


# ---------- connection ----------
class TransportError(SystemExit):
    """TCP/TLS failure (TV wedged or off); a token refresh cannot help."""


class Tv:
    def __init__(self, mode="session", pair=False, password_override=None):
        self.pair = pair
        self.msgs = []  # (topic, payload str, retain)
        self.lock = threading.Lock()
        self.connected = threading.Event()
        self.rc = None
        uuid = sget("UUID")
        if not uuid:
            uuid = ":".join(f"{b:02x}" for b in pysecrets.token_bytes(6))
            sset(UUID=uuid)
        token = sget("ACCESS_TOKEN")
        if token and not pair and sget("MQTT_USERNAME") and sget("CLIENT_ID"):
            self.cid, self.user, self.pw = sget("CLIENT_ID"), sget("MQTT_USERNAME"), token
        else:
            self.cid, self.user, self.pw = make_creds(uuid)
        if password_override:
            self.pw = password_override
        self.state_sub_granted = False
        self.tmpdir = tempfile.mkdtemp(prefix="vidaa-")
        cp, kp = Path(self.tmpdir, "c.pem"), Path(self.tmpdir, "k.pem")
        for p, name in ((cp, "CLIENT_CERT_PEM_BASE64"), (kp, "CLIENT_KEY_PEM_BASE64")):
            fd = os.open(p, os.O_WRONLY | os.O_CREAT, 0o600)
            with os.fdopen(fd, "wb") as f:
                f.write(b64d(sget(name)))
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        ctx.load_cert_chain(cp, kp)
        shutil.rmtree(self.tmpdir, ignore_errors=True)
        self.c = mqtt.Client(mqtt.CallbackAPIVersion.VERSION1, self.cid, reconnect_on_failure=False)
        self.c.username_pw_set(self.user, self.pw)
        self.c.tls_set_context(ctx)
        self.c.on_connect = self._on_connect
        self.c.on_message = self._on_message
        self.c.on_subscribe = self._on_subscribe
        self._state_mid = None
        self.subacks = {}

    def _on_connect(self, c, u, f, rc):
        self.rc = rc
        if rc == 0:
            # Wildcards are refused (SUBACK 128); subscribe to exact topics.
            base = f"/remoteapp/mobile/{self.cid}/"
            for t in ("ui_service/data/authentication", "ui_service/data/authenticationcode",
                      "ui_service/data/authenticationcodeclose", "ui_service/data/authenticationcodetoast",
                      "ui_service/data/tokenissuance", "platform_service/data/tokenissuance",
                      "ui_service/data/vidaa_app_connect", "ui_service/data/state",
                      "ui_service/data/applist", "ui_service/data/sourcelist",
                      "platform_service/data/volume", "platform_service/data/gettvinfo"):
                r = c.subscribe(base + t)
                if t == "ui_service/data/applist":
                    self._state_mid = r[1]
            for t in ("/remoteapp/mobile/broadcast/ui_service/state",
                      "/remoteapp/mobile/broadcast/platform_service/actions/volumechange",
                      "/remoteapp/mobile/broadcast/ui_service/volume"):
                c.subscribe(t)
        self.connected.set()

    def _on_subscribe(self, c, u, mid, granted):
        self.subacks[mid] = bool(granted) and granted[0] != 128

    def _on_message(self, c, u, m):
        with self.lock:
            self.msgs.append((m.topic, m.payload.decode("utf-8", "replace"), bool(m.retain), time.time()))

    def open(self, timeout=8, keepalive=15):
        # paho uses keepalive as the TLS handshake timeout too, so keep it short. Clean socket close on every failure path; transport errors (TLS handshake timeout) become a one-line exit.
        try:
            self.c.connect(host(), PORT, keepalive=keepalive)
        except OSError as e:  # ssl.SSLError and timeouts are OSError subclasses
            self.c.disconnect()
            raise TransportError(f"MQTT connect failed (transport: {e})")
        self.c.loop_start()
        if not self.connected.wait(timeout) or self.rc != 0:
            self.c.disconnect()
            self.c.loop_stop()
            sys.exit(f"MQTT connect failed (rc={self.rc})")
        time.sleep(0.7)  # let retained messages arrive
        return self

    def close(self):
        self.c.loop_stop()
        self.c.disconnect()

    def pub(self, service, action, payload="", raw_topic=False):
        """Publish to /remoteapp/tv/<service>/<cid>/<actions/>action (raw_topic: action is the full tail)."""
        if not isinstance(payload, str):
            payload = json.dumps(payload)
        tail = action if raw_topic else f"actions/{action}"
        self.c.publish(f"/remoteapp/tv/{service}/{self.cid}/{tail}", payload).wait_for_publish(5)

    def wait(self, suffix, timeout=5, since=0):
        end = time.time() + timeout
        while time.time() < end:
            with self.lock:
                for t, p, r, ts in self.msgs:
                    if t.endswith(suffix) and ts >= since:
                        return p
            time.sleep(0.05)
        return None

    def state(self, timeout=4):
        """Latest state JSON (retained broadcast or direct reply)."""
        since = time.time()
        self.pub("ui_service", "gettvstate", "")
        self.wait("ui_service/data/state", 1.5, since)
        time.sleep(0.3)
        with self.lock:
            cands = [(ts, p) for t, p, r, ts in self.msgs
                     if t.endswith("ui_service/state") or t.endswith("ui_service/data/state")]
        if not cands:
            return None
        try:
            return json.loads(max(cands)[1])
        except ValueError:
            return {"raw": max(cands)[1]}

    def apps(self, timeout=6):
        since = time.time()
        self.pub("ui_service", "applist", "")
        p = self.wait("ui_service/data/applist", timeout, since)
        return json.loads(p) if p else None


def connect():
    """Open a session with the stored token; refresh once if the TV refuses it."""
    try:
        return Tv().open()
    except TransportError:
        raise
    except SystemExit:
        if sget("REFRESH_TOKEN") and refresh_token():
            return Tv().open()
        raise


def require_paired():
    if not (sget("ACCESS_TOKEN") or sget("PAIRED") == "1"):
        sys.exit("not paired: run `pair start` first")


MIRROR_PORT = os.environ.get("VIDAA_MIRROR_PORT", "18742")
MIRROR_DIR = Path(os.environ.get("VIDAA_MIRROR_DIR", Path(__file__).resolve().parents[2] / "scratch" / "20261016-codex" / "vidaa"))


def mirror_host():
    """LAN address of this host as the TV sees it (override with $VIDAA_MIRROR_HOST)."""
    h = os.environ.get("VIDAA_MIRROR_HOST")
    if h:
        return h
    import socket
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.connect((host(), 9))
    ip = s.getsockname()[0]
    s.close()
    return ip


def mirror_base():
    return f"http://{mirror_host()}:{MIRROR_PORT}"


def mirror_token():
    t = sget("MIRROR_TOKEN")
    if not t:
        sys.exit("PLAYARR_VIDAA_MIRROR_TOKEN missing from the secrets file")
    return t


def redact(obj):
    """Never print the mirror token (it rides in the debug URL)."""
    txt = json.dumps(obj)
    t = sget("MIRROR_TOKEN")
    return txt.replace(t, "<token>") if t else txt


def foreground_ok(tv):
    """True when the foreground app is Playarr (state mentions the match string), or the TV
    browser/app is showing our own debug mirror page (state url starts with the mirror base)."""
    needle = os.environ.get("VIDAA_FOREGROUND_MATCH", "playarr").lower()
    st = tv.state()
    if not st:
        return False, st
    fields = " ".join(str(st.get(k, "")) for k in ("name", "url", "appId")).lower()
    if st.get("statetype") in ("app", "browser", "webapp") and str(st.get("url", "")).startswith(mirror_base() + "/"):
        return True, st
    return (st.get("statetype") in ("app", "browser", "webapp") and needle in fields), st


# ---------- commands ----------
def cmd_state(a):
    tv = connect()
    print(redact(tv.state()))
    tv.close()


def cmd_apps(a):
    tv = connect()
    apps = tv.apps()
    print(json.dumps(apps, indent=1))
    tv.close()


def cmd_volume(a):
    tv = connect()
    since = time.time()
    tv.pub("platform_service", "getvolume", "")
    p = tv.wait("volume", 4, since)
    with tv.lock:
        vols = [x for x in tv.msgs if "volume" in x[0]]
    print(p if p is not None else (vols[-1][1] if vols else "no volume reply"))
    tv.close()


# Navigation-only keys allowed from the TV's own launcher (state remote_launcher), to reach the Playarr tile.
LAUNCHER_KEYS = {"KEY_UP", "KEY_DOWN", "KEY_LEFT", "KEY_RIGHT", "KEY_OK", "KEY_ENTER", "KEY_BACK", "KEY_RETURN", "KEY_HOME"}


def cmd_key(a):
    tv = connect()
    for k in a.keys:
        k = k.upper()
        if k in BLOCKED_KEYS:
            tv.close()
            sys.exit(f"refused: {k} is blocked by policy")
        if not a.allow_any:
            ok, st = foreground_ok(tv)
            if not ok and st and st.get("statetype") == "remote_launcher" and k in LAUNCHER_KEYS:
                ok = True
            if not ok:
                tv.close()
                sys.exit(f"abort: foreground is not Playarr (state={json.dumps(st)})")
        # Check the authenticated server identity immediately before every remote action.
        require_device_test_account()
        tv.pub("remote_service", "sendkey", k)
        print("sent", k)
        time.sleep(a.delay)
    tv.close()


def cmd_launch(a):
    tv = connect()
    apps = tv.apps() or []
    want = a.app.lower()
    hit = None
    for x in apps if isinstance(apps, list) else []:
        if want in (str(x.get("name", "")).lower(), str(x.get("appId", "")).lower()) or want in str(x.get("name", "")).lower():
            hit = x
            break
    if not hit:
        tv.close()
        sys.exit("app not found; run `apps`")
    if not a.allow_any:
        tv.close()
        sys.exit("launch needs --allow-any (only for starting Playarr)")
    tv.pub("ui_service", "launchapp", {k: hit[k] for k in hit if k != "httpIcon"})
    print("launch requested:", hit.get("name"))
    time.sleep(3)
    print(redact(tv.state()))
    tv.close()


def debug_url(path="/"):
    if not re.fullmatch(r"/[A-Za-z0-9_./?=&%-]*", path) or path.startswith("//"):
        sys.exit("--path must be a plain route on the mirror origin")
    sep = "&" if "?" in path else "?"
    return f"{mirror_base()}{path}{sep}platform=tv-vidaa&mirrorToken={mirror_token()}&r={int(time.time())}"  # r: forces a reload


def cmd_open_debug(a):
    """Open OUR OWN debug-mirror page on the TV (allowed under the guard: it never targets other pages)."""
    import urllib.error
    try:
        urllib.request.urlopen(f"{mirror_base()}/", timeout=4).read(64)
    except Exception as e:
        sys.exit(f"receiver not reachable at the mirror base: {e}")
    tv = connect()
    apps = tv.apps() or []
    base = next((x for x in apps if x.get("appId") == "playarr-tv"), None)
    if not base:
        tv.close()
        sys.exit("Playarr app entry not found; run `apps`")
    payload = {k: base[k] for k in base if k != "httpIcon"}
    variant = a.variant
    if variant == "app":          # the installed Playarr entry, url swapped for our debug page
        payload["url"] = debug_url(a.path)
    elif variant == "webapp":     # a fresh entry, no appId
        payload = {"name": "Playarr Debug", "urlType": 37, "storeType": 98, "url": debug_url(a.path)}
    elif variant == "noid":       # Playarr entry minus appId
        payload.pop("appId", None)
        payload["url"] = debug_url(a.path)
    tv.pub("ui_service", "launchapp", payload)
    print("open-debug requested, variant:", variant)
    time.sleep(a.wait)
    print(redact(tv.state()))
    tv.close()


def _latest(suffix):
    import urllib.parse
    url = f"{mirror_base()}/__mirror/latest.{suffix}?t={urllib.parse.quote(mirror_token())}"
    with urllib.request.urlopen(url, timeout=6) as r:
        return r.read()


def heartbeat_problem(meta, heartbeat, now_ms):
    """Pure check: why a frame may not be used, or None. Identity freshness comes from the newest heartbeat (at most 5 s old);
    slow frames are fine as long as they were produced by the very account the heartbeat still confirms."""
    if not isinstance(heartbeat, dict) or not isinstance(heartbeat.get("receivedAt"), (int, float)):
        return "abort: no identity heartbeat from the mirror"
    if heartbeat["receivedAt"] > now_ms / 1000 or now_ms / 1000 - heartbeat["receivedAt"] > 5:
        return "abort: identity heartbeat is stale"
    hb = heartbeat.get("identity")
    if not isinstance(hb, dict) or hb.get("status") != "ok" or hb.get("sessionChanged") is not False:
        return "abort: authenticated device-test account identity unavailable"
    identity = meta.get("identity") if isinstance(meta, dict) else None
    if not isinstance(identity, dict) or identity.get("status") != "ok" or identity.get("sessionChanged") is not False:
        return "abort: authenticated device-test account identity unavailable"
    if not isinstance(meta.get("receivedAt"), (int, float)) or meta["receivedAt"] > now_ms / 1000:
        return "abort: mirrored frame is stale"
    if (identity.get("username"), identity.get("serverUrl")) != (hb.get("username"), hb.get("serverUrl")):
        return "abort: the signed-in account changed since this frame"
    return None


def require_device_test_account(meta=None, expected_seq=None, require_image=False):
    """Reject without a fresh authenticated current-profile projection from the mirror."""
    import urllib.parse
    if meta is None:
        meta = json.loads(_latest("json") or b"{}")
    if expected_seq is not None and meta.get("seq") != expected_seq:
        sys.exit("abort: mirrored frame changed during capture")
    if require_image and meta.get("hasImage") is not True:
        sys.exit("abort: mirrored frame image is unavailable")
    now_ms = int(time.time() * 1000)
    try:
        url = f"{mirror_base()}/__mirror/heartbeat.json?t={urllib.parse.quote(mirror_token())}"
        heartbeat = json.loads(urllib.request.urlopen(url, timeout=6).read() or b"{}")
    except Exception:
        heartbeat = None
    problem = heartbeat_problem(meta, heartbeat, now_ms)
    if problem:
        sys.exit(problem)
    identity = heartbeat["identity"]  # the newest verification; the frame's own identity matched it above
    try:
        from urllib.parse import urlparse
        trusted = _parse().get("PLAYARR_TEST_SERVER_URL")
        server = identity.get("serverUrl")
        if not trusted or not isinstance(server, str):
            sys.exit("abort: device-test server identity is not trusted")
        expected = urlparse(trusted)
        actual = urlparse(server)
        if (actual.scheme, actual.netloc, actual.path.rstrip("/")) != (expected.scheme, expected.netloc, expected.path.rstrip("/")):
            sys.exit("abort: device-test server identity is not trusted")
    except Exception:
        sys.exit("abort: device-test server identity is not trusted")
    if identity.get("isCurrentCount") != 1 or not isinstance(identity.get("username"), str):
        sys.exit("abort: current server profile is missing or ambiguous")
    configured = _parse()
    allow = {configured.get(k, "").strip() for k in ("PLAYARR_DEVICE_TEST_USERNAME", "PLAYARR_DEVICE_TEST_DPAD_USERNAME", "PLAYARR_PARITY_VIDAA_USERNAME")}
    allow.discard("")
    if identity["username"] not in allow:
        sys.exit("abort: current server user is not an allowlisted device-test account")
    return True


def cmd_guard(a):
    require_device_test_account(expected_seq=getattr(a, "seq", None))
    print("device-test account guard passed")


def cmd_screen(a):
    """Save the latest mirrored frame (JPEG) to the scratch dir and print its metadata path."""
    meta = json.loads(_latest("json") or b"{}")
    require_device_test_account(meta, require_image=True)
    if not meta:
        sys.exit("no frame yet; is the debug page open on the TV? (`open-debug`)")
    out = Path(a.out) if a.out else MIRROR_DIR / "screens" / f"screen-{time.strftime('%H%M%S')}.jpg"
    out.parent.mkdir(parents=True, exist_ok=True)
    try:
        image = _latest("jpg")
        after = json.loads(_latest("json") or b"{}")
        require_device_test_account(after, expected_seq=meta.get("seq"), require_image=True)
        if after.get("identity") != meta.get("identity"):
            sys.exit("abort: mirrored frame identity changed during capture")
        if not image:
            sys.exit("abort: mirrored frame image is empty")
        out.write_bytes(image)
    except Exception:
        sys.exit("abort: latest mirrored image could not be verified")
    out.with_suffix(".json").write_text(json.dumps(meta, indent=1))
    age = time.time() - meta.get("receivedAt", 0)
    print(f"frame: {out}  (age {age:.1f}s, viewport {meta.get('viewport')}, route {meta.get('route')})")


def cmd_focus(a):
    meta = json.loads(_latest("json") or b"{}")
    require_device_test_account(meta)
    if not meta:
        sys.exit("no frame yet")
    print(json.dumps({"route": meta.get("route"), "viewport": meta.get("viewport"), "focus": meta.get("focus"),
                      "age_s": round(time.time() - meta.get("receivedAt", 0), 1), "errors": meta.get("errors"),
                      "captureError": meta.get("captureError")}, indent=1))
    if a.text:
        print(meta.get("text", ""))


def cmd_events(a):
    tv = connect()
    end = time.time() + a.seconds
    seen = 0
    while time.time() < end:
        with tv.lock:
            new = tv.msgs[seen:]
            seen = len(tv.msgs)
        for t, p, r, ts in new:
            print(redact({"t": round(ts, 1), "topic": t.replace(tv.cid, "<cid>"), "retain": r, "payload": p[:400]}))
        time.sleep(0.2)
    tv.close()


def cmd_discover(a):
    print(json.dumps(discover()))


PIN_FILE = STATE_DIR / "pin"
PAIR_LOG = STATE_DIR / "pair.log"


def _store_token(tv, d, log):
    sset(CLIENT_ID=tv.cid, MQTT_USERNAME=tv.user, ACCESS_TOKEN=d.get("accesstoken", ""),
         REFRESH_TOKEN=d.get("refreshtoken", ""), TOKEN_TIME=str(d.get("accesstoken_time", "")),
         TOKEN_DAYS=str(d.get("accesstoken_duration_day", "")),
         REFRESH_TIME=str(d.get("refreshtoken_time", "")), REFRESH_DAYS=str(d.get("refreshtoken_duration_day", "")))
    log("token stored (access %sd, refresh %sd)" % (d.get("accesstoken_duration_day"), d.get("refreshtoken_duration_day")))


def refresh_token(log=lambda s: None):
    """Connect with the refresh token as password, request a new pair (gettoken)."""
    rt = sget("REFRESH_TOKEN")
    if not (rt and sget("CLIENT_ID") and sget("MQTT_USERNAME")):
        return False
    tv = Tv(pair=False, password_override=rt)
    try:
        tv.open()
    except SystemExit:
        log("refresh connect refused")
        return False
    since = time.time()
    tv.pub("platform_service", "data/gettoken", {"refreshtoken": rt}, raw_topic=True)
    p = tv.wait("tokenissuance", 12, since)
    tv.close()
    if not p:
        log("no tokenissuance on refresh")
        return False
    _store_token(tv, json.loads(p), log)
    return True


def verify_auth():
    """Fresh connection with the stored token; authorised iff SUBACK is granted on the state topic."""
    if not sget("ACCESS_TOKEN"):
        return False
    try:
        tv = Tv().open()
    except SystemExit:
        return False
    ok = bool(tv.subacks.get(tv._state_mid))
    tv.close()
    return ok


def pair_daemon(wait_s):
    log = lambda s: PAIR_LOG.open("a").write(f"{time.strftime('%H:%M:%S')} {s}\n")
    tv = Tv(pair=True)
    tv.open()
    log("connected")
    since = time.time()
    tv.pub("ui_service", "vidaa_app_connect", {"app_version": 2, "connect_result": 0, "device_type": "Mobile App"})
    log("step 1: vidaa_app_connect sent (PIN should be on the TV)")
    end = time.time() + wait_s
    done = False
    logged = 0
    while time.time() < end and not done:
        if PIN_FILE.exists():
            pin = PIN_FILE.read_text().strip()
            PIN_FILE.unlink()
            t0 = time.time()
            tv.pub("ui_service", "authenticationcode", {"authNum": int(pin)})  # integer, not string
            log("step 2: PIN sent")
            ac = tv.wait("ui_service/data/authenticationcode", 15, t0)
            log(f"step 3: authenticationcode reply = {ac}")
            try:
                okpin = json.loads(ac).get("result") == 1 if ac else False
            except ValueError:
                okpin = False
            if not okpin:
                log("FAILED: PIN not accepted (result != 1)")
                break
            tv.pub("platform_service", "data/gettoken", {"refreshtoken": ""}, raw_topic=True)
            tv.pub("ui_service", "authenticationcodeclose", "")
            log("step 4: gettoken requested")
            tok = tv.wait("tokenissuance", 15, t0)
            if not tok:
                log("FAILED: no tokenissuance within 15 s")
                break
            _store_token(tv, json.loads(tok), log)
            tv.close()
            time.sleep(1)
            log("step 5: verifying with a fresh connection")
            if verify_auth():
                log("PAIRED: token accepted, applist subscription granted")
            else:
                log("FAILED: token stored but fresh connection is still unauthorised")
            done = True
            break
        with tv.lock:
            for m in tv.msgs[logged:]:
                if "/data/" in m[0] and "tokenissuance" not in m[0]:
                    log("rx " + m[0].rsplit("/", 1)[-1] + " " + m[1][:120])
            logged = len(tv.msgs)
        time.sleep(0.3)
    log("daemon exit" + ("" if done else " (no result)"))
    try:
        tv.close()
    except Exception:
        pass


def cmd_pair(a):
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    if a.sub == "status":
        print(PAIR_LOG.read_text() if PAIR_LOG.exists() else "no pairing attempt")
        print("paired:", verify_auth())
    elif a.sub == "pin":
        fd = os.open(PIN_FILE, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as f:
            f.write(a.value)
        print("PIN handed to daemon")
    elif a.sub == "start":
        if PAIR_LOG.exists():
            PAIR_LOG.unlink()
        if os.fork() == 0:
            os.setsid()
            sys.stdout = sys.stderr = open(os.devnull, "w")
            pair_daemon(1800)
            os._exit(0)
        time.sleep(4)
        print(PAIR_LOG.read_text() if PAIR_LOG.exists() else "starting")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sp = ap.add_subparsers(dest="cmd", required=True)
    sp.add_parser("discover").set_defaults(f=cmd_discover)
    sp.add_parser("state").set_defaults(f=cmd_state)
    sp.add_parser("apps").set_defaults(f=cmd_apps)
    v = sp.add_parser("volume"); v.add_argument("what", choices=["get"]); v.set_defaults(f=cmd_volume)
    k = sp.add_parser("key"); k.add_argument("keys", nargs="+"); k.add_argument("--allow-any", action="store_true")
    k.add_argument("--delay", type=float, default=0.6); k.set_defaults(f=cmd_key)
    l = sp.add_parser("launch"); l.add_argument("app"); l.add_argument("--allow-any", action="store_true"); l.set_defaults(f=cmd_launch)
    od = sp.add_parser("open-debug"); od.add_argument("--variant", choices=["app", "webapp", "noid"], default="app")
    od.add_argument("--wait", type=float, default=5); od.add_argument("--path", default="/"); od.set_defaults(f=cmd_open_debug)
    sc = sp.add_parser("screen"); sc.add_argument("--out"); sc.set_defaults(f=cmd_screen)
    fo = sp.add_parser("focus"); fo.add_argument("--text", action="store_true"); fo.set_defaults(f=cmd_focus)
    gd = sp.add_parser("guard"); gd.add_argument("--seq", type=int); gd.set_defaults(f=cmd_guard)
    e = sp.add_parser("events"); e.add_argument("seconds", type=int, nargs="?", default=15); e.set_defaults(f=cmd_events)
    pr = sp.add_parser("pair"); pr.add_argument("sub", choices=["start", "pin", "status"])
    pr.add_argument("value", nargs="?"); pr.set_defaults(f=cmd_pair)
    a = ap.parse_args()
    a.f(a)


if __name__ == "__main__":
    main()
