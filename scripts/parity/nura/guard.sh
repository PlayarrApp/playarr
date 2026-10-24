#!/usr/bin/env bash
# PLAYARR_CAPTURE_IDENTITY_GUARD for pmcap3.sh: fails unless the app runs and is signed in as PLAYARR_NURA_EXPECTED_SUB.
H=$(cd -- "$(dirname -- "$0")" && pwd)
exp=${PLAYARR_NURA_EXPECTED_SUB:?}
out=$("$H/pmssh.sh" "pgrep -f playarr-mobile >/dev/null || exit 3; python3 -c \"
import json,base64,os
s=json.load(open(os.path.expanduser('~/.local/share/playarr-mobile/sessions.json')))
t=s['sessions'][s['active_key']]['access_token'].split('.')[1]
print(json.loads(base64.urlsafe_b64decode(t+'='*(-len(t)%4))).get('sub'))\"") || exit 1
[ "$out" = "$exp" ] || { echo "identity mismatch" >&2; exit 1; }
