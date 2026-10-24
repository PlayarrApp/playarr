#!/usr/bin/env python3
"""Sign the Nura app in as the static-server `parity` account (stdlib only; prints no secret).

Logs in from the host and writes sessions.json on the VM, then prints `sub <account id>`.
Needs PLAYARR_NURA_SERVER (the static server URL a local device uses) and PLAYARR_PARITY_STATIC_PASSWORD
(in ~/.secrets, or the environment).
"""
import base64, json, os, subprocess, sys, urllib.request, uuid

here = os.path.dirname(os.path.abspath(__file__))
url = os.environ.get("PLAYARR_NURA_SERVER") or sys.exit("PLAYARR_NURA_SERVER is not set")
password = os.environ.get("PLAYARR_PARITY_STATIC_PASSWORD")
if not password:
    for line in open(os.path.expanduser("~/.secrets")):
        k, _, v = line.rstrip("\n").partition("=")
        if k == "PLAYARR_PARITY_STATIC_PASSWORD":
            password = v
password or sys.exit("PLAYARR_PARITY_STATIC_PASSWORD is not set")
device = str(uuid.uuid4())
body = json.dumps({"username": os.environ.get("PLAYARR_NURA_USERNAME", "parity"), "password": password, "device_id": device,
                   "device_name": "nura-parity", "client_platform": "linux-phone", "client_version": "parity"}).encode()
req = urllib.request.Request(url + "/api/v1/auth/login", body, {"content-type": "application/json", "User-Agent": "nura-parity", "X-Playarr-Client-Platform": "linux-phone"})
r = json.load(urllib.request.urlopen(req, timeout=30))
sub = json.loads(base64.urlsafe_b64decode(r["access_token"].split(".")[1] + "==")).get("sub")
key = f"{len(url)}:{url}{sub}"
s = {"active_key": key, "sessions": {key: {"server_url": url, "access_token": r["access_token"], "refresh_token": r["refresh_token"], "device_id": device}}}
cmd = "killall playarr-mobile 2>/dev/null; d=~/.local/share/playarr-mobile; mkdir -p $d; rm -f $d/session.json; cat > $d/sessions.json; chmod 600 $d/sessions.json"
p = subprocess.run([os.path.join(here, "pmssh.sh"), cmd], input=json.dumps(s).encode())
print("sub", sub)
sys.exit(p.returncode)
