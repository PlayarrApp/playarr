#!/usr/bin/env bash
# usage: pmssh.sh <cmd...>  ssh into the Nura (postmarketOS) VM as "user" (forward 2231, key run/pmkey)
H=$(dirname "$0")
exec ssh -i "$H/run/pmkey" -o IdentitiesOnly=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o ConnectTimeout=30 -p 2231 user@127.0.0.1 "$@"
