#!/usr/bin/env python3
"""VIDAA keepalive (systemd --user service). Holds ONE long-lived MQTT client to the TV remote service
(port 36669) and runs a cheap state query every INTERVAL seconds, so the TV never sees idle or
half-open sessions and no tool has to open a fresh connection per command.

Wedge = TLS handshake timeout while the port is open. The service logs WEDGE once, then reconnects with
exponential backoff (15 s .. 300 s) and logs RECOVERED. Recovery is non-destructive only: it never sends
KEY_POWER or volume (the vidaa CLI blocks both), and the remote protocol offers no standby wake.
rc=4 (bad credentials after a TV reboot) logs RE-PAIR NEEDED; only the owner can re-pair.

While another run holds the vidaa-busy lock the client is closed (same MQTT client id as the CLI, so two
sessions would kick each other) and Playarr is not relaunched. Otherwise Playarr is kept in the foreground
(launch at most once per LAUNCH_EVERY seconds).

Env: VIDAA_DIR (dir holding vidaa.py), VIDAA_HOST, KEEPALIVE_LOG, KEEPALIVE_INTERVAL, VIDAA_BUSY_LOCK.
"""
import fcntl
import os
import signal
import sys
import time
from pathlib import Path

DATA = Path("/home/Storage/Projects/repositories/.data/PlayarrApp/playarr")
VIDAA_DIR = os.environ.get("VIDAA_DIR", str(Path(__file__).resolve().parent))  # vidaa.py sits next to this file
LOG = Path(os.environ.get("KEEPALIVE_LOG", DATA / "scratch/20261017-parity-vidaa/keepalive.log"))
LOCK = os.environ.get("VIDAA_BUSY_LOCK", "/run/user/1000/vidaa-busy.lock")
INTERVAL = float(os.environ.get("KEEPALIVE_INTERVAL", "45"))
LAUNCH_EVERY = 300
BACKOFF_MIN, BACKOFF_MAX, BACKOFF_REPAIR = 15, 300, 600


def next_backoff(cur):
    return min(max(cur * 2, BACKOFF_MIN), BACKOFF_MAX)


def log(msg):
    LOG.parent.mkdir(parents=True, exist_ok=True)
    with open(LOG, "a") as f:
        f.write(f"{time.strftime('%Y-%m-%dT%H:%M:%S%z')} {msg}\n")


def busy():
    fd = os.open(LOCK, os.O_RDWR | os.O_CREAT, 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return False
    except BlockingIOError:
        return True
    finally:
        os.close(fd)  # releases our probe lock


def main():
    sys.path.insert(0, VIDAA_DIR)
    import vidaa  # noqa: E402  (needs VIDAA_HOST in env; paho from the venv)

    stop = []
    signal.signal(signal.SIGTERM, lambda *_: stop.append(1))
    signal.signal(signal.SIGINT, lambda *_: stop.append(1))
    tv, wedged, backoff, retry_at, misses, last_launch = None, False, 0, 0.0, 0, 0.0

    def drop(why):
        nonlocal tv
        if tv:
            try:
                tv.close()
            except Exception:
                pass
            tv = None
        log(f"closed client ({why})")

    log(f"start interval={INTERVAL}s host={os.environ.get('VIDAA_HOST')}")
    while not stop:
        try:
            if busy():
                if tv:
                    drop("busy lock held")
                else:
                    log("skip: busy lock held")
            elif tv is None and time.time() >= retry_at:
                try:
                    tv = vidaa.connect()
                    if wedged:
                        log("RECOVERED: remote service answers again")
                    wedged, backoff, misses = False, 0, 0
                    log("connected")
                except vidaa.TransportError as e:
                    if not wedged:
                        log(f"WEDGE: {e}")
                    wedged, backoff = True, next_backoff(backoff)
                    retry_at = time.time() + backoff
                    log(f"retry in {backoff}s")
                except SystemExit as e:
                    msg = str(e)
                    if "rc=4" in msg:
                        log("RE-PAIR NEEDED: MQTT rc=4 (bad credentials, probably after a TV reboot). Owner must run pair.sh at the TV.")
                        retry_at = time.time() + BACKOFF_REPAIR
                    else:
                        backoff = next_backoff(backoff)
                        retry_at = time.time() + backoff
                        log(f"connect failed: {msg}; retry in {backoff}s")
            elif tv is not None:
                fg, st = vidaa.foreground_ok(tv)
                if st is None:
                    misses += 1
                    log(f"state query got no reply ({misses})")
                    if misses >= 2:
                        drop("no state replies")
                        wedged, retry_at = True, time.time() + BACKOFF_MIN
                        log("WEDGE: connected but no state replies")
                else:
                    misses = 0
                    log(f"ok: {vidaa.redact(st)[:200]} foreground={fg}")
                    if not fg and time.time() - last_launch >= LAUNCH_EVERY:
                        last_launch = time.time()
                        apps = tv.apps() or []
                        hit = next((a for a in apps if "playarr" in str(a.get("name", "")).lower()), None)
                        if hit:
                            tv.pub("ui_service", "launchapp", {k: hit[k] for k in hit if k != "httpIcon"})
                            log("launched Playarr (was not foreground)")
                        else:
                            log("Playarr not in app list")
        except Exception as e:  # keep the service alive; the connection is suspect after any error
            log(f"error: {type(e).__name__}: {e}")
            drop("error")
            retry_at = time.time() + BACKOFF_MIN
        end = time.time() + INTERVAL
        while not stop and time.time() < end:
            time.sleep(0.5)
    drop("stopping")


if __name__ == "__main__":
    main()
