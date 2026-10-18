#!/usr/bin/env python3
"""Fail closed before Harmony captures unless the device account and pinned fixtures exist."""
import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]


def request(server, path, *, method="GET", token=None, body=None, timeout=8):
    headers = {"accept": "application/json", "user-agent": "playarr-harmony-wall-preflight"}
    data = None
    if body is not None:
        headers["content-type"] = "application/json"
        data = json.dumps(body).encode("utf-8")
    if token:
        headers["authorization"] = "Bearer " + token
    req = urllib.request.Request(server.rstrip("/") + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            raw = response.read()
            try:
                payload = json.loads(raw) if raw else None
            except (ValueError, UnicodeDecodeError):
                payload = None
            return response.status, payload
    except urllib.error.HTTPError as error:
        error.close()
        return error.code, None
    except Exception:
        return 0, None


def _fixtures():
    suite = json.loads((REPO / "scripts/parity/suite.json").read_text(encoding="utf-8"))
    detail_routes = [
        (screen["id"], screen["open"].rstrip("/").split("/")[-1])
        for screen in suite.get("screens", [])
        if screen.get("id") in ("film-detail", "series-detail")
    ]
    seed = (HERE / "seed_progress.py").read_text(encoding="utf-8")
    match = re.search(r'^KEEP\s*=\s*["\']([^"\']+)["\']', seed, re.MULTILINE)
    if len(detail_routes) != 2 or not match:
        raise ValueError("pinned fixture configuration unavailable")
    return detail_routes, match.group(1)


def check_fixtures(server, username, password, *, requester=request, static=False):
    result = {"ready": False, "identity": "unverified", "fixtures": {}, "failure": None}
    try:
        parsed = urllib.parse.urlsplit(server.strip())
    except (AttributeError, ValueError):
        result["failure"] = "invalid-server-url"
        return result
    if (parsed.scheme not in ("http", "https") or not parsed.netloc or parsed.username is not None
            or parsed.password is not None or parsed.query or parsed.fragment):
        result["failure"] = "invalid-server-url"
        return result
    if not username or not password:
        result["failure"] = "device-test-credentials-missing"
        return result
    try:
        details, seed_id = _fixtures()
    except (OSError, ValueError, KeyError, json.JSONDecodeError):
        result["failure"] = "pinned-fixture-configuration-unavailable"
        return result

    status, session = requester(server, "/api/v1/auth/login", method="POST", body={
        "username": username,
        "password": password,
        "device_id": str(uuid.uuid4()),
        "device_name": "harmony-wall-fixture-preflight",
        "client_platform": "web",
        "client_version": "parity",
    })
    result["login_status"] = status
    token = session.get("access_token") if status == 200 and isinstance(session, dict) else None
    if not isinstance(token, str) or not token:
        result["failure"] = "device-test-login-failed"
        return result

    status, profiles = requester(server, "/api/v1/users/profiles", token=token)
    rows = profiles if isinstance(profiles, list) else profiles.get("profiles", []) if isinstance(profiles, dict) else []
    rows = rows if isinstance(rows, list) else []
    matched = any(isinstance(profile, dict) and profile.get("username") == username
                  and profile.get("is_current") is True for profile in rows)
    result["profile_status"] = status
    result["identity"] = "verified" if status == 200 and matched else "unverified"
    if result["identity"] != "verified":
        result["failure"] = "device-test-profile-mismatch"
        return result

    fixtures_ok = True
    for label, fixture_id in details:
        encoded_id = urllib.parse.quote(fixture_id, safe="-")
        fixture_status, payload = requester(server, "/api/v1/catalog/" + encoded_id, token=token)
        work = payload.get("work") if isinstance(payload, dict) else None
        present = fixture_status == 200 and isinstance(work, dict) and work.get("id") == fixture_id
        result["fixtures"][label] = fixture_status
        fixtures_ok = fixtures_ok and present

    # The static parity server already holds the canonical On deck; the pinned live item is absent there by design.
    if not static:
        encoded_seed = urllib.parse.quote(seed_id, safe="-")
        seed_status, _ = requester(server, "/api/v1/playback/" + encoded_seed + "/progress", token=token)
        result["fixtures"]["seed-progress"] = seed_status
        fixtures_ok = fixtures_ok and seed_status == 200
    result["ready"] = fixtures_ok
    if not fixtures_ok:
        result["failure"] = "pinned-fixture-unavailable"
    return result


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--output")
    args = parser.parse_args(argv)
    result = check_fixtures(os.environ.get("SERVER_URL", ""), os.environ.get("TEST_USERNAME", ""),
                            os.environ.get("TEST_PASSWORD", ""),
                            static=os.environ.get("PARITY_STATIC_SERVER") == "1")
    rendered = json.dumps(result, separators=(",", ":"))
    if args.output:
        try:
            Path(args.output).write_text(rendered + "\n", encoding="utf-8")
        except OSError:
            result = {"ready": False, "failure": "report-write-error"}
            rendered = json.dumps(result, separators=(",", ":"))
    print(rendered, flush=True)
    return 0 if result["ready"] else 1


if __name__ == "__main__":
    sys.exit(main())
