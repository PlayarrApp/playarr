#!/usr/bin/env bash
# usage: pmsync.sh <worktree playarr dir>  copy clients/linux-mobile + shared avatars to the Nura VM (~/src)
H=$(dirname "$0"); W=$1
tar -C "$W" --exclude=target -cf - clients/linux-mobile clients/shared/profile-avatars/plates | "$H/pmssh.sh" 'mkdir -p ~/src && tar -C ~/src -xf -'
