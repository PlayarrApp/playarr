#!/usr/bin/env bash
# Like-for-like A/B: every arm on a fresh boot of the pilot emulator unit (its memory grows over time and throttles after ~40 min).
#   perf-ab-fresh.sh <apk> <out-dir> <unit> <serial> [iterations]   arms: web, nativeA, nativeB, nativeALT
# Both arms are AOT-compiled after install (perf-ab.sh, PERF_COMPILE=none to skip) as a Play install would be.
# Then aggregate: node perf-agg.mjs web=<out>/web:web nativeA=<out>/nativeA:nativeA nativeB=<out>/nativeB:nativeB
set -euo pipefail
apk=$1; out=$2; unit=$3; serial=$4; n=${5:-10}
here=$(cd "$(dirname "$0")" && pwd)
export ANDROID_SERIAL=$serial
# PERF_WEB_APK: a separate APK for the web arm (the native-only build has no web assets). PERF_ARMS: arms to run, in order.
for arm in ${PERF_ARMS:-web nativeA nativeB}; do
  variant=${arm%%[A-Z]*}
  arm_apk=$apk; [ "$variant" = web ] && arm_apk=${PERF_WEB_APK:-$apk}
  # PERF_ALT_APK: the APK for an arm named like nativeALT (an A/B of two native builds, e.g. with and without a baseline profile).
  case $arm in *ALT) arm_apk=${PERF_ALT_APK:?PERF_ALT_APK for the ALT arm} ;; esac
  systemctl --user restart "$unit"
  sleep 15
  for _ in $(seq 1 60); do [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ] && break; sleep 4; done
  sleep 45  # let boot-time services settle
  adb install -r "$arm_apk" >/dev/null
  mkdir -p "$out/$arm"
  PERF_MEM_DUMP="$out/$arm/mem" "$here/perf-ab.sh" "$variant" "$n" "$out/$arm" > "$out/$arm.log" 2>&1 || echo "arm $arm failed (see $out/$arm.log)" >&2
  # perf-ab.sh writes <variant>.jsonl; name it after the arm
  [ "$variant" = "$arm" ] || mv "$out/$arm/$variant.jsonl" "$out/$arm/$arm.jsonl"
done
