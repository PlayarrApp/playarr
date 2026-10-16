#!/usr/bin/env python3
"""Approve a device code (RFC 8628 user_code shown by the app) as the Device Test account.
Environment: SERVER_URL, TEST_USERNAME, TEST_PASSWORD. Usage: approve_link.py <user_code>. Prints statuses only, never a value."""
import argparse, hashlib, json, os, sys, urllib.error, urllib.request
from capture_identity import authorize_after_identity_setup

parser = argparse.ArgumentParser()
parser.add_argument("user_code")
parser.add_argument("--identity-control-url")
args = parser.parse_args()

server = os.environ.get("PLAYARR_TEST_SERVER_URL", "").strip().rstrip("/")
if not server: sys.exit("PLAYARR_TEST_SERVER_URL is required")


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


# A fresh device id per run: a run never shares a session with another run or device.
import uuid
status, out = call("/api/v1/auth/login", {"username": os.environ["TEST_USERNAME"], "password": os.environ["TEST_PASSWORD"],
                                          "device_id": str(uuid.uuid4()), "device_name": "harmony-wall approver",
                                          "client_platform": "web", "client_version": "parity"})
print("login", status)
if status != 200:
    sys.exit(1)
token = json.loads(out)["access_token"]
user_id = json.loads(out).get("user_id")
if not isinstance(user_id, str) or not user_id:
    print("identity digest unavailable")
    sys.exit(1)
identity_digest = hashlib.sha256(user_id.encode()).hexdigest()
try:
    status, _ = authorize_after_identity_setup(args.user_code, token, identity_digest,
                                               args.identity_control_url, call)
except (OSError, ValueError):
    print("identity control unavailable")
    sys.exit(1)
print("authorize", status)
if status in (200, 204):
    print("IDENTITY_SHA256=" + identity_digest)
sys.exit(0 if status in (200, 204) else 1)
