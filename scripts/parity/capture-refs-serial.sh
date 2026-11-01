#!/usr/bin/env bash
# Usage: capture-refs-serial.sh <group,group,...> <capture-refs.mjs args...>
# Captures the web reference groups strictly one after another, each group in its own systemd-run cgroup, so no group shares
# CPU or memory pressure with another and a stray browser dies with its scope. Needs PARITY_CHROME, PARITY_CLIENT, PARITY_LOCK_DIR
# like capture-refs.mjs; pass --work <dir> (and --no-copy or --parity-root) in the remaining arguments.
set -euo pipefail
cd "$(dirname "$0")"
groups="${1:?group list required}"; shift
IFS=, read -ra list <<< "$groups"
for g in "${list[@]}"; do
  systemd-run --user --scope --quiet -p MemoryHigh=8G -p MemoryMax=12G -p MemorySwapMax=512M -- node capture-refs.mjs --groups "$g" "$@"
done
