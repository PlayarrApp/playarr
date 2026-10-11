#!/usr/bin/env python3
"""Prints an access token for the device test account on its "Device Test" profile (the token only, to stdout).

Environment: SERVER_URL, TEST_USERNAME, TEST_PASSWORD, optional DEVICE_NAME. Errors name the step, never a value.
"""
import json
import os
import sys
import urllib.error
import urllib.request
import uuid

server = os.environ["SERVER_URL"].strip().rstrip("/")
# A fixed per-device-name id keeps one registered device per wall device across runs.
device = {"device_id": str(uuid.uuid5(uuid.NAMESPACE_DNS, "apple-wall." + os.environ.get("DEVICE_NAME", "wall"))),
          "device_name": os.environ.get("DEVICE_NAME", "apple-wall"), "client_platform": "ios", "client_version": "apple-wall"}


def call(path, body=None, token=None, what="request"):
    headers = {"content-type": "application/json", "user-agent": "playarr-apple-wall"}
    if token:
        headers["authorization"] = "Bearer " + token
    req = urllib.request.Request(server + path, data=None if body is None else json.dumps(body).encode(), headers=headers,
                                 method="GET" if body is None else "POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        sys.exit(f"{what} failed: HTTP {error.code}")


login = call("/api/v1/auth/login", dict(device, username=os.environ["TEST_USERNAME"], password=os.environ["TEST_PASSWORD"]), what="login")
profiles = call("/api/v1/users/profiles", token=login["access_token"], what="profile list")
profiles = profiles if isinstance(profiles, list) else profiles.get("profiles", [])
wanted = next((p for p in profiles if p.get("display_name") == "Device Test"), None)
if wanted is None:
    sys.exit("profile 'Device Test' not found on the account")
if wanted["id"] != login.get("user_id") and not wanted.get("is_current"):
    login = call("/api/v1/auth/login", dict(device, profile_user_id=wanted["id"]), token=login["access_token"], what="profile switch")
print(login["access_token"])
