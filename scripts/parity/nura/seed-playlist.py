#!/usr/bin/env python3
"""Seed the one playlist the frozen seed lacks ("Parity Watch Night": pinned film, pinned series, one more title) on the
static server's throw-away DB copy, as the web refs do. Skipped when a playlist exists. Needs PLAYARR_NURA_SERVER and
PLAYARR_PARITY_STATIC_PASSWORD (environment or ~/.secrets)."""
import json, os, sys, urllib.request, uuid

url = (os.environ.get("PLAYARR_NURA_SERVER") or sys.exit("PLAYARR_NURA_SERVER is not set")).rstrip("/")
password = os.environ.get("PLAYARR_PARITY_STATIC_PASSWORD")
if not password:
    for line in open(os.path.expanduser("~/.secrets")):
        k, _, v = line.rstrip("\n").partition("=")
        if k.removeprefix("export ") == "PLAYARR_PARITY_STATIC_PASSWORD":
            password = v.strip("\"'")
password or sys.exit("PLAYARR_PARITY_STATIC_PASSWORD is not set")
FILM, SERIES = "ca309574-c0f4-4564-bb54-4512eab7e531", "7ab4ce97-d59e-43d6-8e03-31d4d29a5c90"


def call(path, body=None, auth=None):
    h = {"content-type": "application/json", **({"authorization": f"Bearer {auth}"} if auth else {})}
    r = urllib.request.Request(url + path, data=None if body is None else json.dumps(body).encode(), headers=h)
    with urllib.request.urlopen(r, timeout=30) as f:
        return json.load(f)


tok = call("/api/v1/auth/login", {"client_platform": "linux-phone", "client_version": "parity", "device_id": str(uuid.uuid4()),
                                   "device_name": "parity-design", "username": "parity", "password": password})["access_token"]
have = call("/api/v1/playlists", auth=tok)
if isinstance(have, dict):
    have = have.get("items") or have.get("playlists") or []
if have:
    print("playlist exists:", len(have))
else:
    p = call("/api/v1/playlists", {"name": "Parity Watch Night", "media_type": "video"}, tok)
    for w in (FILM, SERIES, "4ec39b80-28c3-4d83-9f83-f07872e5f4c0"):
        call(f"/api/v1/playlists/{p['id']}/items", {"work_id": w}, tok)
    print("playlist created", p["id"])
