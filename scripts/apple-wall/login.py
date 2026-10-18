#!/usr/bin/env python3
"""Prints an access token for the device test account on its "Device Test" profile ("<access> <refresh>" on one line, to stdout).

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
device = {"device_id": "5a1e0000-0000-4000-8000-%012x" % (uuid.uuid5(uuid.NAMESPACE_DNS, "apple-wall." + os.environ.get("DEVICE_NAME", "wall")).int & 0xFFFFFFFFFFFF),
          "device_name": os.environ.get("DEVICE_NAME", "apple-wall"), "client_platform": "ios", "client_version": "parity"}

if "--device-id" in sys.argv:  # the id the app must send with this token (the server ties a token to its device)
    print(device["device_id"])
    sys.exit(0)


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
device_profiles = [p for p in profiles if p.get("display_name") == "Device Test"]
if len(device_profiles) != 1:
    sys.exit("expected exactly one Device Test profile on the account")
wanted = device_profiles[0]
if wanted.get("username") != os.environ["TEST_USERNAME"]:
    sys.exit("Device Test profile does not belong to the configured device-test account")
print("login: user_id match=%s is_current=%s pin_locked=%s" % (wanted["id"] == login.get("user_id"), wanted.get("is_current"), wanted.get("pin_locked")), file=sys.stderr)
if wanted["id"] != login.get("user_id"):
    login = call("/api/v1/auth/login", dict(device, profile_user_id=wanted["id"]), token=login["access_token"], what="profile switch")
    if login.get("user_id") != wanted["id"]:
        sys.exit("profile switch did not sign in as the Device Test profile")

# Verify the session the app will receive, after any profile switch. A stale
# login response or failed switch must never start a capture under another
# household profile.
verified_profiles = call("/api/v1/users/profiles", token=login["access_token"], what="profile verification")
verified_profiles = verified_profiles if isinstance(verified_profiles, list) else verified_profiles.get("profiles", [])
current = [p for p in verified_profiles if p.get("is_current") is True]
if (len(current) != 1 or current[0].get("id") != login.get("user_id")
        or current[0].get("id") != wanted["id"]
        or current[0].get("display_name") != "Device Test"
        or current[0].get("username") != os.environ["TEST_USERNAME"]):
    sys.exit("signed-in profile verification failed; capture aborted")
if "--include-user-id" in sys.argv:
    print(login["access_token"], login["refresh_token"], login["user_id"])
    sys.exit(0)
print(login["access_token"], login["refresh_token"])  # the refresh token belongs to the same session: an app that refreshes needs it
