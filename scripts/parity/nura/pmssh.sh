#!/usr/bin/env bash
# usage: pmssh.sh <cmd...>  ssh into the Nura (postmarketOS) VM as "user" (forward 2231, key run/pmkey)
H=$(dirname "$0")
K=${PLAYARR_NURA_KEY:-$H/run/pmkey}
[ -r "$K" ] || { echo "pmssh: VM key $K not found; see README (Local files)" >&2; exit 1; }
exec ssh -i "$K" -o IdentitiesOnly=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o ConnectTimeout=30 -p 2231 user@127.0.0.1 "$@"
