#!/usr/bin/env bash
# Restart the shared Android phone emulator's systemd unit when its host memory has grown past a limit.
#   emu-recycle.sh <user-unit> <adb-serial> [max-anon-gib=7]
# This only mitigates the swiftshader leak between batches; it does not cure it (the leak is inside the emulator).
# Why: the swiftshader emulator leaks about 190 MiB of host memory per app launch and never gives it back. After a few
# dozen launches the unit reaches its MemoryHigh, reclaim throttles it and adb hangs, and the guest watchdog reboots it
# (seen as "Can't find service: activity" or a run that stops mid-batch). Recycling between batches keeps it clear of that.
set -euo pipefail
unit=${1:-}; serial=${2:?adb serial}; max_gib=${3:-7}
# PARITY_EMU_SSH=<host>: the unit runs on that host (reached with ssh); the adb serial is still driven locally (tunnelled adb server).
sh_() { if [ -n "${PARITY_EMU_SSH:-}" ]; then ssh -o BatchMode=yes "$PARITY_EMU_SSH" "$@"; else bash -c "$*"; fi; }
# No unit means the emulator is not a systemd user unit here (for example one started by hand): nothing to recycle.
if [ -z "$unit" ] || ! sh_ "systemctl --user cat '$unit'" >/dev/null 2>&1; then echo "emu-recycle: no systemd user unit, skipped"; exit 0; fi
anon=$(sh_ 'cg=/sys/fs/cgroup/user.slice/user-$(id -u).slice/user@$(id -u).service/app.slice/'"$unit"'; awk "\$1==\"anon\"{print \$2}" $cg/memory.stat')
limit=$((max_gib * 1024 * 1024 * 1024))
echo "emu-recycle: $unit anon=$((anon / 1048576)) MiB, limit $((max_gib * 1024)) MiB"
[ "$anon" -le "$limit" ] && exit 0
# Flush the guest disk first: a restart right after an install used to lose the installed app.
adb -s "$serial" shell sync >/dev/null 2>&1 || true; sleep 5
# A transient unit cannot be restarted (it is removed when stopped): kill the emulator through adb and let Restart=always bring it back.
if ! sh_ "systemctl --user restart '$unit'" 2>/dev/null; then
  adb -s "$serial" emu kill >/dev/null 2>&1 || true
  sleep 30
fi
timeout 600 bash -c "until [ \"\$(timeout 10 adb -s '$serial' shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')\" = 1 ]; do sleep 10; done"
sleep 60  # let system_server settle before the first activity start
for _ in 1 2 3; do "$(dirname "$0")/emu-setup.sh" "$serial" "${PARITY_WM_SIZE:-}" "${PARITY_WM_DENSITY:-}" && break; sleep 20; done
echo "emu-recycle: restarted and booted"
