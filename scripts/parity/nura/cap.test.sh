#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd -- "$(dirname -- "$0")" && pwd)
SCRATCH=${PLAYARR_TEST_TMPDIR:-}
if [ -z "$SCRATCH" ] || [ ! -d "$SCRATCH" ]; then
  echo 'set PLAYARR_TEST_TMPDIR to an existing scratch directory' >&2
  exit 2
fi
TEST_ROOT=$SCRATCH/nura-cap-test-$$
mkdir -p "$TEST_ROOT/bin" "$TEST_ROOT/venv/bin" "$TEST_ROOT/out"
printf 'test scratch: %s\n' "$TEST_ROOT"

cat > "$TEST_ROOT/vnc.sh" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
[[ "$2" == capture ]]
[ "${VNC_MODE:-ok}" = ok ] || exit 17
printf 'capture\n' > "$3"
MOCK
cat > "$TEST_ROOT/venv/bin/python" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" > "$PYTHON_ARGS"
[ "${PYTHON_MODE:-ok}" = ok ] || exit 19
MOCK
chmod +x "$TEST_ROOT/vnc.sh" "$TEST_ROOT/venv/bin/python"
cp "$ROOT/cap.sh" "$TEST_ROOT/cap.sh"

PYTHON_ARGS=$TEST_ROOT/python-args PLAYARR_TEST_TMPDIR="$SCRATCH" \
  "$TEST_ROOT/cap.sh" fixture "$TEST_ROOT/out/full.png"
[[ $(cat "$TEST_ROOT/out/full.png") == capture ]]

PYTHON_ARGS=$TEST_ROOT/python-args "$TEST_ROOT/cap.sh" fixture \
  "$TEST_ROOT/out/full-scaled.png" 2 "$TEST_ROOT/out/small.png"
[[ $(cat "$TEST_ROOT/python-args") == *"$TEST_ROOT/out/full-scaled.png 2 $TEST_ROOT/out/small.png"* ]]

set +e
VNC_MODE=fail PYTHON_ARGS=$TEST_ROOT/python-args \
  "$TEST_ROOT/cap.sh" fixture "$TEST_ROOT/out/vnc-fail.png"
status=$?
set -e
[[ $status -eq 17 ]] || { echo "VNC failure returned $status, expected 17" >&2; exit 1; }

set +e
"$TEST_ROOT/cap.sh" fixture "$TEST_ROOT/out/invalid-scale.png" 00 \
  "$TEST_ROOT/out/small.png"
status=$?
set -e
[[ $status -eq 2 ]] || { echo "invalid divisor returned $status, expected 2" >&2; exit 1; }

set +e
PYTHON_MODE=fail PYTHON_ARGS=$TEST_ROOT/python-args \
  "$TEST_ROOT/cap.sh" fixture "$TEST_ROOT/out/scale-source.png" 2 \
  "$TEST_ROOT/out/scale-target.png"
status=$?
set -e
[[ $status -eq 19 ]] || { echo "scaling failure returned $status, expected 19" >&2; exit 1; }

echo 'Nura cap helper mocked tests passed'
