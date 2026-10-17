#!/usr/bin/env bash
# Fail when iOS app code outside `#if DEBUG` references a symbol that only exists in DEBUG builds
# (the parity hooks), which breaks the Release archive. Symbols: every type declared at the top level
# of a Parity*.swift file wrapped wholly in `#if DEBUG`.
set -euo pipefail
cd "$(dirname "$0")/../.."
python3 - <<'PY'
import re, sys, pathlib
root = pathlib.Path("clients/ios/Sources/PlayarrApp")
files = sorted(root.rglob("*.swift"))
debug_files = [f for f in files if re.search(r"^#if DEBUG\s*$", f.read_text(), re.M)
               and f.read_text().rstrip().endswith("#endif") and f.name.startswith("Parity")]
syms = set()
for f in debug_files:
    syms |= set(re.findall(r"^(?:final )?(?:enum|struct|class|actor)\s+(\w+)", f.read_text(), re.M))
if not syms:
    sys.exit("no debug-only symbols found; the check is stale")
pat = re.compile(r"\b(" + "|".join(sorted(syms)) + r")\b")
bad = []
for f in files:
    if f in debug_files:
        continue
    stack = []  # one bool per open #if: does it contain DEBUG
    for n, line in enumerate(f.read_text().splitlines(), 1):
        t = line.strip()
        if t.startswith("#if"):
            stack.append(bool(re.search(r"(?<![!\w])DEBUG\b", t)) and "!DEBUG" not in t)
        elif t.startswith("#else") or t.startswith("#elseif"):
            if stack: stack[-1] = False
        elif t.startswith("#endif"):
            if stack: stack.pop()
        elif not any(stack) and not t.startswith("//") and pat.search(line):
            bad.append(f"{f}:{n}: {t}")
if bad:
    print("Debug-only parity symbols used outside #if DEBUG (Release will not compile):", *bad, sep="\n  ")
    sys.exit(1)
print(f"ok: {len(syms)} debug-only symbols ({', '.join(sorted(syms))}) only used under #if DEBUG")
PY
