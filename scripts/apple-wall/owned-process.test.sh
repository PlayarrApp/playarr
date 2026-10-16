#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
source "$SCRIPT_DIR/owned-process.sh"
test_dir="${PLAYARR_TEST_SCRATCH:?set to task-scoped scratch directory}/owned-process-test.$$"
mkdir "$test_dir"
trap 'rm -f "$test_dir/pid"; rmdir "$test_dir"' EXIT

EXPECTED_PID=4242
MOCK_PATH=/Applications/PlayarrMac.app/Contents/MacOS/PlayarrMac
MOCK_EXITED=false
KILLED_PID=
EXPECTED_PID_FILE=$test_dir/pid
lsof() {
  [[ $MOCK_EXITED == false ]] || return 0
  printf 'p%s\nftxt\nn%s\n' "$EXPECTED_PID" "$MOCK_PATH"
}
ps() {
  [[ $MOCK_EXITED == false ]] || return 1
  printf '/Applications/PlayarrMac.app/Contents/MacOS/PlayarrMac -PlayarrParityProcessIDFile %s\n' "$EXPECTED_PID_FILE"
}
kill() {
  if [[ $1 == -0 ]]; then return 0; fi
  KILLED_PID=$1
  MOCK_EXITED=true
}

printf '%s\n' "$EXPECTED_PID" > "$test_dir/pid"
stop_owned_process "$test_dir/pid" "$MOCK_PATH"
[[ $KILLED_PID == "$EXPECTED_PID" && ! -e $test_dir/pid ]] || {
  echo 'matching PID file was not stopped and cleared' >&2; exit 1;
}

MOCK_EXITED=false
KILLED_PID=
EXPECTED_PID_FILE=/old/launch.pid
printf '%s\n' "$EXPECTED_PID" > "$test_dir/pid"
stop_owned_process "$test_dir/pid" /Applications/PlayarrMac.app/Contents/MacOS/PlayarrMac
[[ -z $KILLED_PID && ! -e $test_dir/pid ]] || {
  echo 'unrelated executable was signalled or PID file was retained' >&2; exit 1;
}

MOCK_PATH=/Applications/PlayarrMac.app/Contents/MacOS/PlayarrMac
printf '%s\n' 'not-a-pid' > "$test_dir/pid"
stop_owned_process "$test_dir/pid" "$MOCK_PATH"
[[ -z $KILLED_PID && -e $test_dir/pid ]] || {
  echo 'invalid PID file was signalled or unexpectedly removed' >&2; exit 1;
}

echo 'owned-process checks passed'
