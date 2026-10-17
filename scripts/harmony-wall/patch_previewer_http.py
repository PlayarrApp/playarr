#!/usr/bin/env python3
"""Apply the narrowly verified OpenHarmony Previewer HTTP cleanup correction."""

from __future__ import annotations

import hashlib
import sys
from pathlib import Path


# OpenHarmony 6.1 build 31 Windows Previewer libhttp.dll. HandleCurlData
# cleans the CURL easy handle before ReadResponse removes and cleans it again.
# NOP only the first cleanup call; retain ReadResponse's remove and cleanup.
ORIGINAL_SHA256 = "76f96e774a5ae097d723bde5e3b9ef87e6d0c625b34578b325b833df961377a3"
PATCHED_SHA256 = "91d85b709fae8d9aed27d6b3283c753b00edb7624415ec5a26e90539542014e5"
FILE_OFFSET = 0x2121B
ORIGINAL_CALL = bytes.fromhex("ff 15 07 d0 12 00")
PATCHED_CALL = b"\x90" * len(ORIGINAL_CALL)


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def patch(path: Path) -> str:
    data = path.read_bytes()
    current = digest(data)
    if current == PATCHED_SHA256:
        return "already-patched"
    if current != ORIGINAL_SHA256:
        raise ValueError(f"unsupported Previewer libhttp.dll SHA-256: {current}")
    if data[FILE_OFFSET : FILE_OFFSET + len(ORIGINAL_CALL)] != ORIGINAL_CALL:
        raise ValueError("Previewer libhttp.dll cleanup call bytes did not match")

    patched = bytearray(data)
    patched[FILE_OFFSET : FILE_OFFSET + len(ORIGINAL_CALL)] = PATCHED_CALL
    if digest(patched) != PATCHED_SHA256:
        raise ValueError("patched Previewer libhttp.dll SHA-256 did not match")
    path.write_bytes(patched)
    return "patched"


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: patch_previewer_http.py <libhttp.dll>", file=sys.stderr)
        return 2
    try:
        result = patch(Path(sys.argv[1]))
    except (OSError, ValueError) as error:
        print(f"Previewer HTTP patch failed: {error}", file=sys.stderr)
        return 1
    print(f"Previewer HTTP cleanup correction: {result}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
