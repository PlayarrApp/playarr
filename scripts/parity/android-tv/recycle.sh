#!/usr/bin/env bash
# Restart the headless Android TV emulator unit and wait until it has booted (used through PARITY_EMU_RECYCLE_CMD by run.sh).
set -euo pipefail
unit=${PARITY_EMU_UNIT:-playarr-android-tv-vnc.service}
serial=${ANDROID_SERIAL:-emulator-5560}
systemctl --user restart "$unit"
for _ in $(seq 120); do
  [ "$(adb -s "$serial" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ] && break
  sleep 3
done
sleep 20
adb -s "$serial" reverse "tcp:${PARITY_ART_PORT:-18495}" "tcp:${PARITY_ART_PORT:-18495}" >/dev/null
