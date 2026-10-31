#!/usr/bin/env bash
# usage: pmsync.sh <worktree playarr dir>  copy clients/linux-mobile + shared avatars to the Nura VM (~/src), then build there
# (cargo build --release) and stamp the build with the git tree id of clients/linux-mobile. run.sh refuses to capture when the
# stamp is not the checkout's tree id, so a capture can never come from a stale binary.
set -euo pipefail
H=$(dirname "$0"); W=$1
T=$(git -C "$W" rev-parse HEAD:clients/linux-mobile)
if ! git -C "$W" diff --quiet HEAD -- clients/linux-mobile clients/shared/profile-avatars/plates; then T=dirty; fi
"$H/pmssh.sh" 'rm -f ~/src/.built-tree; mkdir -p ~/src && tar -C ~/src -xf -' < <(tar -C "$W" --exclude=target -cf - clients/linux-mobile clients/shared/profile-avatars/plates)
"$H/pmssh.sh" "cd ~/src/clients/linux-mobile && cargo build --release 2>&1 | tail -3 && printf %s $T > ~/src/.built-tree" </dev/null
