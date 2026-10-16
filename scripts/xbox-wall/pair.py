#!/usr/bin/env python3
"""Sign the app in as the Device Test account: read the pairing code the app shows (parity.json "code"), approve it with this
job's own device id. Env: XBOX_IO, PLAYARR_TEST_SERVER_URL, TEST_USERNAME, TEST_PASSWORD. Prints statuses only, never secrets."""
import json, os, subprocess, sys, time, urllib.request, uuid
srv = os.environ.get('PLAYARR_TEST_SERVER_URL', '').strip().rstrip('/')
if not srv: sys.exit('PLAYARR_TEST_SERVER_URL is required')
def call(method, url, body=None, token=None):
    h = {'Content-Type': 'application/json', 'Accept': 'application/json', 'User-Agent': 'playarr-xbox-wall'}
    if token: h['Authorization'] = 'Bearer ' + token
    req = urllib.request.Request(url, method=method, headers=h, data=json.dumps(body).encode() if body is not None else None)
    try:
        r = urllib.request.urlopen(req, timeout=30); return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()
def trace():
    try: return json.loads(subprocess.check_output([os.environ['XBOX_IO'], 'read'], text=True))
    except Exception: return {}
account_key = os.environ.get('TEST_ACCOUNT_KEY', '')
if account_key not in ('PLAYARR_DEVICE_TEST_USERNAME', 'PLAYARR_DEVICE_TEST_DPAD_USERNAME'):
    sys.exit('refusing Xbox parity run: TEST_ACCOUNT_KEY is not an approved device-test credential key')
username = os.environ['TEST_USERNAME']
st, out = call('POST', srv + '/api/v1/auth/login', {'username': username, 'password': os.environ['TEST_PASSWORD'],
    'device_id': str(uuid.uuid4()), 'device_name': 'xbox wall approver', 'client_platform': 'web', 'client_version': '1.0'})
print('login', st)
if st != 200: sys.exit(1)
tok = json.loads(out)['access_token']
expected_user_id = json.loads(out)['user_id']

def require_device_test_identity():
    nonce = uuid.uuid4().hex
    marker = json.dumps({'userId': expected_user_id, 'nonce': nonce, 'serverUrl': srv})
    subprocess.check_call([os.environ['XBOX_IO'], 'write', 'parity.expected-user', marker])
    for _ in range(15):
        t = trace()
        if t.get('accountProbe') == nonce and t.get('accountMatchesTest') is True:
            print('signed-in account verified as device test')
            return
        if t.get('accountProbe') == nonce and t.get('accountMatchesTest') is False:
            sys.exit('refusing Xbox parity run: signed-in account does not match the device-test account')
        time.sleep(2)
    sys.exit('refusing Xbox parity run: signed-in account identity was not verified')

code = None
for _ in range(90):
    t = trace()
    if t.get('screen') in ('profiles', 'home'):
        require_device_test_identity()
        sys.exit(0)
    if t.get('code'): code = t['code']; break
    time.sleep(2)
if not code: sys.exit('no pairing code on screen')
# The app shows a hosted-link code: mint a server device code, approve it, then hand it to the link service (as the web's /link page does).
st, out = call('POST', srv + '/api/v1/oauth/device/code', {'client_platform': 'xbox'}, tok)
print('server code', st)
if st != 200: sys.exit(1)
sc = json.loads(out)
st, _ = call('POST', srv + '/api/v1/oauth/device/authorize', {'user_code': sc['user_code']}, tok)
print('server authorize', st)
if st >= 300: sys.exit(1)
st, _ = call('POST', 'https://playarr.app/api/link/authorize', {'user_code': code, 'server_url': srv, 'server_device_code': sc['device_code'], 'server_urls': [srv]})
print('link authorize', st)
if st >= 300: sys.exit(1)
for _ in range(60):
    if trace().get('screen') == 'profiles':
        require_device_test_identity()
        sys.exit(0)
    time.sleep(2)
sys.exit('app did not reach the profile picker')
