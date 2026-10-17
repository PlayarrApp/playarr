#!/usr/bin/env bash
# Make a cold-booted Sailfish SDK emulator (VirtualBox) usable for parity captures.
# Symptom without this: every capture shows only the lipstick wallpaper or a "Playarr is not responding" dialog.
# Cause: the VM disk is slow when the host is busy (guest fsync 2.7 MB/s with host I/O cache off), so lipstick and
# pulseaudio miss systemd's 1 minute start timeout and restart in a loop, and the app misses the compositor ping.
# Fix (two parts):
#   1. host, VM powered off, once:  VBoxManage storagectl <vm> --name SATA --hostiocache on   (fsync 2.7 to 41 MB/s)
#   2. guest, this script, once per disk image: 10 minute start timeouts for lipstick and pulseaudio, then unlock the
#      screen and stop it blanking or locking again.
# usage: vm-coldboot.sh   env: PLAYARR_SF_SSH_KEY, PLAYARR_SF_SSH_PORT (default 2223), PLAYARR_SF_SSH_HOST (default 127.0.0.1)
set -euo pipefail
: "${PLAYARR_SF_SSH_KEY:?private key of the emulator}"
sf() { ssh -i "$PLAYARR_SF_SSH_KEY" -p "${PLAYARR_SF_SSH_PORT:-2223}" -o StrictHostKeyChecking=no -o BatchMode=yes -o ConnectTimeout=10 "root@${PLAYARR_SF_SSH_HOST:-127.0.0.1}" "$@"; }
# A cold boot takes 2 to 4 minutes before ssh answers and the lock screen is up.
for _ in $(seq 1 120); do sf true 2>/dev/null && break; sleep 3; done
sf 'for u in lipstick pulseaudio; do mkdir -p /etc/systemd/user/$u.service.d; printf "[Service]\nTimeoutStartSec=10min\n" > /etc/systemd/user/$u.service.d/timeout.conf; done'
for _ in $(seq 1 120); do sf 'journalctl -b --no-pager | grep -q "Started The lipstick security prompt UI"' && break; sleep 3; done
sf 'export PATH=/usr/sbin:/usr/bin:/sbin:/bin
D="dbus-send --system --print-reply --type=method_call --dest=com.nokia.mce /com/nokia/mce/request"
$D com.nokia.mce.request.req_display_state_on
$D com.nokia.mce.request.req_tklock_mode_change string:unlocked
for k in display_blank_timeout display_dim_timeout; do $D com.nokia.mce.request.set_config objpath:/system/osso/dsm/display/$k variant:int32:3600; done
$D com.nokia.mce.request.set_config objpath:/system/osso/dsm/display/inhibit_blank_mode variant:int32:3' >/dev/null
echo "sailfish VM ready: unlocked, timeouts raised"
