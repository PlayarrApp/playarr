#!/usr/bin/env python3
"""Prints an access token for the device test account on its "Device Test" profile ("<access> <refresh>" on one line, to stdout).

Environment: SERVER_URL, TEST_USERNAME, TEST_PASSWORD, optional DEVICE_NAME or APPLE_WALL_DEVICE_NAME. Errors name the step, never a value.
"""
import json
import os
import sys
import urllib.error
import urllib.request
import uuid

server = os.environ["SERVER_URL"].strip().rstrip("/")


def device_identity():
    # A hosted matrix job gets its own refresh-token family. Outside the hosted
    # workflow, retain the stable per-device identity used by existing callers.
    name = os.environ.get("APPLE_WALL_DEVICE_NAME") or os.environ.get("DEVICE_NAME")
    seed_name = name or "wall"
    display_name = name or "apple-wall"
    return {"device_id": "5a1e0000-0000-4000-8000-%012x" % (uuid.uuid5(uuid.NAMESPACE_DNS, "apple-wall." + seed_name).int & 0xFFFFFFFFFFFF),
            "device_name": display_name, "client_platform": "ios", "client_version": "parity"}


if "--device-id" in sys.argv:  # the id the app must send with this token (the server ties a token to its device)
    print(device_identity()["device_id"])
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


def main():
    device = device_identity()
    login = call("/api/v1/auth/login", dict(device, username=os.environ["TEST_USERNAME"], password=os.environ["TEST_PASSWORD"]), what="login")
    profiles = call("/api/v1/users/profiles", token=login["access_token"], what="profile list")
    profiles = profiles if isinstance(profiles, list) else profiles.get("profiles", [])
    wanted = next((p for p in profiles if p.get("display_name") == "Device Test"), None)
    if wanted is None or not wanted.get("id"):
        sys.exit("profile 'Device Test' not found on the account")
    if wanted["id"] != login.get("user_id"):
        login = call("/api/v1/auth/login", dict(device, profile_user_id=wanted["id"]), token=login["access_token"], what="profile switch")

    # `is_current` is supplied by GET /api/v1/users/profiles from the
    # authenticated streaming user. Re-read it after switching so captures
    # cannot continue with a token for another profile or an unknown identity.
    current_profiles = call("/api/v1/users/profiles", token=login.get("access_token"), what="profile verification")
    current_profiles = current_profiles if isinstance(current_profiles, list) else current_profiles.get("profiles", [])
    current = [p for p in current_profiles if p.get("is_current") is True]
    if (len(current) != 1 or current[0].get("id") != wanted["id"]
            or current[0].get("display_name") != "Device Test"):
        sys.exit("profile identity verification failed; capture aborted")
    if not login.get("access_token") or not login.get("refresh_token"):
        sys.exit("login response incomplete; capture aborted")
    print(login["access_token"], login["refresh_token"])


if __name__ == "__main__":
    main()
