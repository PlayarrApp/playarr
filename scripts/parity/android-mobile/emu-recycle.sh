#!/usr/bin/env bash
# Restart the shared Android phone emulator's systemd unit when its host memory has grown past a limit.
#   emu-recycle.sh <user-unit> <adb-serial> [max-anon-gib=7]
# Why: the swiftshader emulator leaks about 190 MiB of host memory per app launch and never gives it back. After a few
# dozen launches the unit reaches its MemoryHigh, reclaim throttles it and adb hangs, and the guest watchdog reboots it
# (seen as "Can't find service: activity" or a run that stops mid-batch). Recycling between batches keeps it clear of that.
set -euo pipefail
unit=${1:?user unit name}; serial=${2:?adb serial}; max_gib=${3:-7}
cg=/sys/fs/cgroup/user.slice/user-$(id -u).slice/user@$(id -u).service/app.slice/$unit
anon=$(awk '$1=="anon"{print $2}' "$cg/memory.stat")
limit=$((max_gib * 1024 * 1024 * 1024))
echo "emu-recycle: $unit anon=$((anon / 1048576)) MiB, limit $((max_gib * 1024)) MiB"
[ "$anon" -le "$limit" ] && exit 0
systemctl --user restart "$unit"
timeout 600 bash -c "until [ \"\$(timeout 10 adb -s '$serial' shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')\" = 1 ]; do sleep 10; done"
sleep 60  # let system_server settle before the first activity start
echo "emu-recycle: restarted and booted"
