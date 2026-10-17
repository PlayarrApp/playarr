#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd -- "$(dirname -- "$0")/../../.." && pwd)
SCRIPT=$ROOT/scripts/parity/nura/pmcap3.sh
SCRATCH=${PLAYARR_TEST_TMPDIR:-}
if [ -z "$SCRATCH" ] || [ ! -d "$SCRATCH" ]; then
  echo "set PLAYARR_TEST_TMPDIR to an existing scratch directory" >&2
  exit 2
fi

TEST_ROOT=$SCRATCH/pmcap3-test-$$
mkdir -p "$TEST_ROOT/bin" "$TEST_ROOT/out"
BIN=$TEST_ROOT/bin

cat > "$BIN/ssh" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
command_text=$1
case $command_text in
  *"pgrep -f release/playarr-mobile"*) [ "${APP_RUNNING:-yes}" = yes ] ;;
  "printf %s "*) printf '%s\n' "$command_text" >> "$SSH_LOG" ;;
  "[ ! -e "*) [ "${ACK_MODE:-yes}" = yes ] ;;
  *) echo "unexpected mocked SSH command: $command_text" >&2; exit 90 ;;
esac
MOCK

cat > "$BIN/cap" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
[ "${CAP_MODE:-ok}" = fail ] && exit 1
[ "${CAP_MODE:-ok}" = skip ] && exit 0
printf 'mock image\n' > "$2"
MOCK

cat > "$BIN/hasher" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
[ "${HASH_MODE:-stable}" = fail ] && exit 1
if [ "${HASH_MODE:-stable}" = unstable ]; then
  count=0
  if [ -s "$HASH_COUNTER" ]; then read -r count < "$HASH_COUNTER"; fi
  count=$((count + 1))
  printf '%s\n' "$count" > "$HASH_COUNTER"
  printf 'digest-%s\n' "$count"
else
  printf 'stable-digest\n'
fi
MOCK

cat > "$BIN/identity" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$1" >> "$IDENTITY_LOG"
[ "${APP_RUNNING:-yes}" = yes ] && [ "${IDENTITY_MODE:-ok}" = ok ]
MOCK

cat > "$BIN/sleep" <<'MOCK'
#!/usr/bin/env bash
exit 0
MOCK
chmod +x "$BIN/ssh" "$BIN/cap" "$BIN/hasher" "$BIN/identity" "$BIN/sleep"

fail() { echo "FAIL: $*" >&2; exit 1; }
expect_error() {
  rg -q "$2" "$1" || fail "expected error '$2' was absent from $1"
}
run_case() {
  local name=$1 out=$TEST_ROOT/out/$1
  shift
  local route=home
  if [ "$#" -gt 0 ] && [[ "$1" == *:* ]]; then route=$1; shift; fi
  mkdir -p "$out"
  : > "$TEST_ROOT/ssh.log"
  : > "$TEST_ROOT/identity.log"
  : > "$TEST_ROOT/hash-counter"
  env PATH="$BIN:$PATH" \
    PLAYARR_CONTROL="$TEST_ROOT/remote-route" \
    PLAYARR_CAPTURE_IDENTITY_GUARD="$BIN/identity" \
    PLAYARR_NURA_SSH="$BIN/ssh" PLAYARR_NURA_CAP="$BIN/cap" \
    PLAYARR_CAPTURE_HASHER="$BIN/hasher" \
    PLAYARR_CAPTURE_ACK_ATTEMPTS="${PLAYARR_CAPTURE_ACK_ATTEMPTS:-2}" \
    PLAYARR_CAPTURE_STABILITY_ATTEMPTS="${PLAYARR_CAPTURE_STABILITY_ATTEMPTS:-3}" \
    PLAYARR_CAPTURE_STABILITY_DELAY="${PLAYARR_CAPTURE_STABILITY_DELAY:-0}" \
    SSH_LOG="$TEST_ROOT/ssh.log" IDENTITY_LOG="$TEST_ROOT/identity.log" \
    HASH_COUNTER="$TEST_ROOT/hash-counter" "$@" "$SCRIPT" "$out" "$route"
}

mkdir -p "$TEST_ROOT/out/no-identity"
printf 'done\n' > "$TEST_ROOT/out/no-identity/DONE"
if env PLAYARR_CONTROL="$TEST_ROOT/remote-route" "$SCRIPT" "$TEST_ROOT/out/no-identity" home > "$TEST_ROOT/no-identity.log" 2>&1; then
  fail "missing identity verifier was accepted"
fi
if [ -e "$TEST_ROOT/out/no-identity/DONE" ]; then fail "missing identity verifier left DONE"; fi
expect_error "$TEST_ROOT/no-identity.log" 'PLAYARR_CAPTURE_IDENTITY_GUARD must name an executable'

mkdir -p "$TEST_ROOT/out/invalid-attempts"
printf 'done\n' > "$TEST_ROOT/out/invalid-attempts/DONE"
if PLAYARR_CAPTURE_STABILITY_ATTEMPTS=0 run_case invalid-attempts > "$TEST_ROOT/invalid-attempts.log" 2>&1; then
  fail "invalid stability attempts were accepted"
fi
[ ! -e "$TEST_ROOT/out/invalid-attempts/DONE" ] || fail "invalid stability attempts left DONE"
expect_error "$TEST_ROOT/invalid-attempts.log" 'attempt counts must be positive integers'

if APP_RUNNING=no run_case absent-app > "$TEST_ROOT/absent-app.log" 2>&1; then
  fail "absent app was accepted"
fi
[ ! -e "$TEST_ROOT/out/absent-app/DONE" ] || fail "absent app left DONE"
expect_error "$TEST_ROOT/absent-app.log" 'identity verification failed'
[ "$(wc -l < "$TEST_ROOT/identity.log")" -eq 1 ] || fail "identity verifier did not check the isolated app before routing"
[ ! -s "$TEST_ROOT/ssh.log" ] || fail "route was requested when the isolated app was absent"

if IDENTITY_MODE=fail run_case identity-failure > "$TEST_ROOT/identity-failure.log" 2>&1; then
  fail "identity verification failure was accepted"
fi
[ ! -e "$TEST_ROOT/out/identity-failure/DONE" ] || fail "identity failure left DONE"
expect_error "$TEST_ROOT/identity-failure.log" 'identity verification failed'
[ ! -s "$TEST_ROOT/ssh.log" ] || fail "route was requested after identity verification failed"

if ACK_MODE=no run_case ack-timeout > "$TEST_ROOT/ack-timeout.log" 2>&1; then
  fail "route acknowledgement timeout was accepted"
fi
[ ! -e "$TEST_ROOT/out/ack-timeout/DONE" ] || fail "route timeout left DONE"
expect_error "$TEST_ROOT/ack-timeout.log" 'timed out waiting for route acknowledgement'

if CAP_MODE=fail run_case capture-failure > "$TEST_ROOT/capture-failure.log" 2>&1; then
  fail "capture failure was accepted"
fi
[ ! -e "$TEST_ROOT/out/capture-failure/DONE" ] || fail "capture failure left DONE"
expect_error "$TEST_ROOT/capture-failure.log" 'capture failed'

mkdir -p "$TEST_ROOT/out/stale-capture"
printf 'stale image\n' > "$TEST_ROOT/out/stale-capture/home.png"
if CAP_MODE=skip run_case stale-capture > "$TEST_ROOT/stale-capture.log" 2>&1; then
  fail "stale capture output was accepted"
fi
[ ! -e "$TEST_ROOT/out/stale-capture/DONE" ] || fail "stale capture output left DONE"
expect_error "$TEST_ROOT/stale-capture.log" 'capture failed'

if HASH_MODE=fail run_case hash-failure > "$TEST_ROOT/hash-failure.log" 2>&1; then
  fail "hash failure was accepted"
fi
[ ! -e "$TEST_ROOT/out/hash-failure/DONE" ] || fail "hash failure left DONE"
expect_error "$TEST_ROOT/hash-failure.log" 'image hashing failed'

if HASH_MODE=unstable run_case unstable > "$TEST_ROOT/unstable.log" 2>&1; then
  fail "unstable capture was accepted"
fi
[ ! -e "$TEST_ROOT/out/unstable/DONE" ] || fail "unstable capture left DONE"
expect_error "$TEST_ROOT/unstable.log" 'capture did not stabilise'

run_case stable > "$TEST_ROOT/stable.log" 2>&1 || fail "stable capture failed"
[ -s "$TEST_ROOT/out/stable/DONE" ] || fail "stable capture did not write DONE"
[ "$(wc -l < "$TEST_ROOT/identity.log")" -eq 3 ] || fail "identity verifier did not run before route and both screenshots"
if run_case theme-only theme:dark > "$TEST_ROOT/theme-only.log" 2>&1; then
  fail "a theme change without a screen capture was accepted"
fi
[ ! -e "$TEST_ROOT/out/theme-only/DONE" ] || fail "theme-only run left DONE"
expect_error "$TEST_ROOT/theme-only.log" 'no screen captures were requested'
if rg -q 'killall|rm -f|setsid|nohup' "$TEST_ROOT/ssh.log"; then
  fail "capture attempted to restart the app or delete remote state"
fi

echo "pmcap3 mocked regression checks passed"
