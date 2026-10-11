#!/usr/bin/env python3
"""Sign the app in as the Device Test account: read the pairing code the app shows (parity.json "code"), approve it with this
job's own device id. Env: XBOX_IO, SERVER_URL, TEST_USERNAME, TEST_PASSWORD. Prints statuses only, never secrets."""
import json, os, subprocess, sys, time, urllib.request, uuid
srv = os.environ['SERVER_URL'].rstrip('/')
def call(method, url, body=None, token=None):
    h = {'Content-Type': 'application/json', 'Accept': 'application/json'}
    if token: h['Authorization'] = 'Bearer ' + token
    req = urllib.request.Request(url, method=method, headers=h, data=json.dumps(body).encode() if body is not None else None)
    try:
        r = urllib.request.urlopen(req, timeout=30); return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()
def trace():
    try: return json.loads(subprocess.check_output([os.environ['XBOX_IO'], 'read'], text=True))
    except Exception: return {}
code = None
for _ in range(90):
    t = trace()
    if t.get('screen') in ('profiles', 'home'): print('already signed in'); sys.exit(0)
    if t.get('code'): code = t['code']; break
    time.sleep(2)
if not code: sys.exit('no pairing code on screen')
st, out = call('POST', srv + '/api/v1/auth/login', {'username': os.environ['TEST_USERNAME'], 'password': os.environ['TEST_PASSWORD'],
    'device_id': str(uuid.uuid4()), 'device_name': 'xbox wall approver', 'client_platform': 'web', 'client_version': '1.0'})
print('login', st)
if st != 200: sys.exit(1)
st, out = call('POST', srv + '/api/v1/oauth/device/authorize', {'user_code': code}, json.loads(out)['access_token'])
print('authorize', st)
if st >= 300: sys.exit(1)
for _ in range(60):
    if trace().get('screen') == 'profiles': print('signed in'); sys.exit(0)
    time.sleep(2)
sys.exit('app did not reach the profile picker')
