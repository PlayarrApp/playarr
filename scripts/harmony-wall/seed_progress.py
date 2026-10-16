#!/usr/bin/env python3
"""Seed the Device Test account's watch progress so Home's On deck matches the web reference run to run: a pinned test item at 15098 ms and
nothing else in progress (any other started row is zeroed to unseen, as the parity reset helper does, which keeps the unseen dots web shows).
Environment: PLAYARR_TEST_SERVER_URL, TEST_USERNAME, TEST_PASSWORD. Best effort: prints statuses only, never a value, and always exits 0."""
import json, os, sys, urllib.error, urllib.request, uuid

SERVER = os.environ.get("PLAYARR_TEST_SERVER_URL", "").strip().rstrip("/")
if not SERVER: sys.exit("PLAYARR_TEST_SERVER_URL is required")
KEEP = "a2c2cf1c-2059-4289-88fb-c7882a3ed7b7"
KEEP_POSITION_MS = 15098


def call(method, path, body=None, token=None):
    headers = {"content-type": "application/json", "accept": "application/json", "user-agent": "playarr-harmony-wall"}
    if token:
        headers["authorization"] = "Bearer " + token
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(SERVER + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, ""
    except (urllib.error.URLError, TimeoutError) as e:
        return 0, ""


def main() -> int:
    status, out = call("POST", "/api/v1/auth/login", {"username": os.environ["TEST_USERNAME"], "password": os.environ["TEST_PASSWORD"],
                                                      "device_id": str(uuid.uuid4()), "device_name": "harmony-wall seed",
                                                      "client_platform": "web", "client_version": "parity"})
    print("seed login", status)
    if status != 200:
        return 0
    token = json.loads(out)["access_token"]
    status, out = call("GET", "/api/v1/playback/progress", token=token)
    rows = json.loads(out) if status == 200 and out else []
    rows = rows if isinstance(rows, list) else rows.get("items", [])
    done = 0
    for row in rows:
        media = row.get("media_file_id") if isinstance(row, dict) else None
        if not media or media == KEEP or row.get("state") == "unseen":
            continue
        duration = int(row.get("duration_ms") or row.get("position_ms") or 1)
        s, _ = call("PUT", "/api/v1/playback/%s/progress" % media, {"position_ms": 0, "duration_ms": duration, "completed": False}, token)
        done += 1 if s in (200, 204) else 0
    print("seed zeroed others", done, "of", len(rows))
    s, _ = call("PUT", "/api/v1/playback/%s/progress" % KEEP, {"position_ms": KEEP_POSITION_MS, "duration_ms": 6742000, "completed": False}, token)
    print("seed keep", s)
    return 0


if __name__ == "__main__":
    sys.exit(main())
