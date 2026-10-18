#!/usr/bin/env python3
"""Read one fresh Android accessibility hierarchy and assert visible content."""
import argparse
import os
import re
import subprocess
import sys
import xml.etree.ElementTree as ET


def matching_nodes(xml_bytes, patterns, width, height):
    root = ET.fromstring(xml_bytes)
    if root.tag != "hierarchy":
        raise ValueError("invalid accessibility hierarchy")
    compiled = [re.compile(pattern, re.IGNORECASE) for pattern in patterns]
    values = []
    for node in root.iter("node"):
        bounds = re.fullmatch(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", node.get("bounds", ""))
        if bounds is None:
            continue
        left, top, right, bottom = map(int, bounds.groups())
        if right <= left or bottom <= top or left >= width or top >= height or right <= 0 or bottom <= 0:
            continue
        if node.get("visible-to-user") == "false":
            continue
        text = " ".join((node.get("text", ""), node.get("content-desc", "")))
        if text.strip():
            values.append(text)
    return all(any(pattern.search(value) for value in values) for pattern in compiled)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("patterns", nargs="+")
    parser.add_argument("--adb", required=True)
    parser.add_argument("--serial", required=True)
    parser.add_argument("--width", type=int, default=2560)
    parser.add_argument("--height", type=int, default=1600)
    args = parser.parse_args()
    remote = f"/sdcard/playarr-parity-hierarchy-{os.getpid()}.xml"
    try:
        subprocess.run([args.adb, "-s", args.serial, "shell", "uiautomator", "dump", remote], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=20)
        xml_bytes = subprocess.run([args.adb, "-s", args.serial, "exec-out", "cat", remote], check=True, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=10).stdout
        if not xml_bytes or not matching_nodes(xml_bytes, args.patterns, args.width, args.height):
            return 1
    except (subprocess.SubprocessError, OSError, ET.ParseError, ValueError):
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
