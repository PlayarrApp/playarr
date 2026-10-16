#!/usr/bin/env python3
"""Approve a device code (RFC 8628 user_code shown by the app) as the Device Test account.
Environment: SERVER_URL, TEST_USERNAME, TEST_PASSWORD. Usage: approve_link.py <user_code>. Prints statuses only, never a value."""
import json, os, sys, urllib.error, urllib.request

server = os.environ["SERVER_URL"].strip().rstrip("/")


def call(path, body, token=None):
    headers = {"content-type": "application/json", "accept": "application/json", "user-agent": "playarr-harmony-wall"}
    if token:
        headers["authorization"] = "Bearer " + token
    req = urllib.request.Request(server + path, data=json.dumps(body).encode(), headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, ""


def get(path, token):
    headers = {"accept": "application/json", "user-agent": "playarr-harmony-wall",
               "authorization": "Bearer " + token}
    req = urllib.request.Request(server + path, headers=headers, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, ""


# A fresh device id per run: a run never shares a session with another run or device.
import uuid
status, out = call("/api/v1/auth/login", {"username": os.environ["TEST_USERNAME"], "password": os.environ["TEST_PASSWORD"],
                                          "device_id": str(uuid.uuid4()), "device_name": "harmony-wall approver",
                                          "client_platform": "web", "client_version": "parity"})
print("login", status)
if status != 200:
    sys.exit(1)
token = json.loads(out)["access_token"]
status, profiles = get("/api/v1/users/profiles", token)
print("account-check", status)
if status != 200:
    sys.exit(1)
try:
    profile_list = json.loads(profiles)
    if not isinstance(profile_list, list) or any(not isinstance(profile, dict) for profile in profile_list):
        raise ValueError("malformed profile list")
    current = [profile for profile in profile_list if profile.get("is_current") is True]
except (TypeError, ValueError):
    sys.exit(1)
if len(current) != 1 or current[0].get("username") != os.environ["TEST_USERNAME"]:
    print("account-check failed: login is not the configured test account")
    sys.exit(1)
status, _ = call("/api/v1/oauth/device/authorize", {"user_code": sys.argv[1]}, token)
print("authorize", status)
sys.exit(0 if status in (200, 204) else 1)
