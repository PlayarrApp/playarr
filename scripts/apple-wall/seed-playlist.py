#!/usr/bin/env python3
"""Design report fixture: one playlist of pinned titles when the account has none (the frozen seed has no playlists).

Environment: SERVER_URL, ACCESS_TOKEN. The static server's database is a throw-away copy, so nothing persists.
"""
import json
import os
import sys
import urllib.request

server = os.environ["SERVER_URL"].strip().rstrip("/")
token = os.environ["ACCESS_TOKEN"]
works = ["ca309574-c0f4-4564-bb54-4512eab7e531", "7ab4ce97-d59e-43d6-8e03-31d4d29a5c90", "4ec39b80-28c3-4d83-9f83-f07872e5f4c0"]


def call(path, body=None):
    request = urllib.request.Request(server + path, data=None if body is None else json.dumps(body).encode(), method="GET" if body is None else "POST",
                                     headers={"content-type": "application/json", "authorization": "Bearer " + token})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


existing = call("/api/v1/playlists")
if isinstance(existing, dict):
    existing = existing.get("items") or existing.get("playlists") or []
if existing:
    print("playlist exists")
    sys.exit(0)
playlist = call("/api/v1/playlists", {"name": "Parity Watch Night", "media_type": "video"})
for work in works:
    call("/api/v1/playlists/%s/items" % playlist["id"], {"work_id": work})
print("playlist seeded")
