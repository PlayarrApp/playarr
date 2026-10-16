#!/usr/bin/env python3
"""Seed deterministic watch progress for the Harmony parity capture.

Environment: SERVER_URL, TEST_USERNAME, TEST_PASSWORD. Prints statuses only,
never account or server values, and exits nonzero on any failed verification or write.
"""
import json, os, sys, urllib.error, urllib.request, uuid

KEEP = "a2c2cf1c-2059-4289-88fb-c7882a3ed7b7"  # The 5th Wave
KEEP_POSITION_MS = 15098


def call(method, path, body=None, token=None):
    headers = {"content-type": "application/json", "accept": "application/json", "user-agent": "playarr-harmony-wall"}
    if token:
        headers["authorization"] = "Bearer " + token
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, ""
    except (urllib.error.URLError, TimeoutError) as e:
        return 0, ""


def require_json(status, out, expected_status, description):
    if status != expected_status or not out:
        raise ValueError(f"{description} failed ({status})")
    try:
        return json.loads(out)
    except (TypeError, ValueError) as error:
        raise ValueError(f"{description} returned malformed data") from error


def seed_progress(server, username, password, request=call):
    status, out = request("POST", server + "/api/v1/auth/login", {"username": username, "password": password,
                                                                      "device_id": str(uuid.uuid4()), "device_name": "harmony-wall seed",
                                                                      "client_platform": "web", "client_version": "parity"})
    session = require_json(status, out, 200, "seed login")
    token = session.get("access_token") if isinstance(session, dict) else None
    if not isinstance(token, str) or not token:
        raise ValueError("seed login returned no access token")

    status, out = request("GET", server + "/api/v1/users/profiles", token=token)
    profiles = require_json(status, out, 200, "seed account verification")
    if not isinstance(profiles, list) or any(not isinstance(profile, dict) for profile in profiles):
        raise ValueError("seed account verification returned malformed profiles")
    current = [profile for profile in profiles if profile.get("is_current") is True]
    if len(current) != 1 or current[0].get("username") != username:
        raise ValueError("seed account does not match the configured Device Test account")

    status, out = request("GET", server + "/api/v1/playback/progress", token=token)
    rows = require_json(status, out, 200, "seed progress read")
    if isinstance(rows, dict):
        rows = rows.get("items")
    if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
        raise ValueError("seed progress read returned malformed rows")
    for row in rows:
        media = row.get("media_file_id")
        if not media or media == KEEP or row.get("state") == "unseen":
            continue
        duration = int(row.get("duration_ms") or row.get("position_ms") or 1)
        status, _ = request("PUT", server + "/api/v1/playback/%s/progress" % media,
                            {"position_ms": 0, "duration_ms": duration, "completed": False}, token)
        if status not in (200, 204):
            raise ValueError(f"seed progress reset failed ({status})")
    status, _ = request("PUT", server + "/api/v1/playback/%s/progress" % KEEP,
                        {"position_ms": KEEP_POSITION_MS, "duration_ms": 6742000, "completed": False}, token)
    if status not in (200, 204):
        raise ValueError(f"seed canonical progress failed ({status})")
    return len(rows)


def main() -> int:
    server = os.environ["SERVER_URL"].strip().rstrip("/")
    try:
        rows = seed_progress(server, os.environ["TEST_USERNAME"], os.environ["TEST_PASSWORD"])
    except (KeyError, ValueError, TypeError, OverflowError) as error:
        print("seed failed:", str(error), flush=True)
        return 1
    print("seed complete; progress rows checked", rows, flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
