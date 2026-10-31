#!/usr/bin/env bash
# usage: pmfresh.sh <worktree playarr dir>  exit 1 unless the app built on the Nura VM is the checkout's clients/linux-mobile.
H=$(dirname "$0"); W=${1:-$H/../../..}
T=$(git -C "$W" rev-parse HEAD:clients/linux-mobile)
git -C "$W" diff --quiet HEAD -- clients/linux-mobile clients/shared/profile-avatars/plates || { echo "pmfresh: uncommitted changes under clients/linux-mobile" >&2; exit 1; }
B=$("$H/pmssh.sh" 'cat ~/src/.built-tree 2>/dev/null' </dev/null || true)
[ "$B" = "$T" ] || { echo "pmfresh: the VM app was built from tree '${B:-none}', the checkout is $T; run pmsync.sh first" >&2; exit 1; }
