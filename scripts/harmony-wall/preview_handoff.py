#!/usr/bin/env python3
"""Validate the files passed by parity-harmony's Linux build to Previewer."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path


HERE = Path(__file__).resolve().parent
WORKFLOW = HERE.parents[1] / ".github/workflows/parity-harmony.yml"
PREVIEW_SCRIPT = HERE / "preview.sh"

# These paths map to the arguments in preview.sh and the Windows Previewer command:
# -j consumes modules.abc and the copied SDK mock; -arp consumes the resource table,
# -pages main_pages resolves main_pages.json, -ljPath consumes loader.json, and
# -srmPath consumes the generated router map. Playarr's working setup does not pass
# pkgContextInfo.json to Previewer, so it is not a handoff requirement.
REQUIRED_FILES = (
    "default/intermediates/loader_out/default/ets/modules.abc",
    "default/intermediates/loader_out/default/ets/apiMock/jsMockHmos.abc",
    "default/intermediates/res/default/ResourceTable.txt",
    "default/intermediates/res/default/resources/base/profile/main_pages.json",
    "default/intermediates/loader/default/loader.json",
    "default/intermediates/router_map/default/router_map.json",
)


def check_output(preview_root: Path) -> list[str]:
    missing = [str(preview_root / relative) for relative in REQUIRED_FILES if not (preview_root / relative).is_file()]
    work_root = preview_root.parents[2]
    system_hsp = work_root / "hms-previewer/systemHsp"
    if not system_hsp.is_dir():
        missing.append(str(system_hsp))
    return missing


def check_workflow(workflow: Path) -> list[str]:
    text = workflow.read_text(encoding="utf-8")
    preview_script = PREVIEW_SCRIPT.read_text(encoding="utf-8")
    errors = []
    upload_start = text.find("- uses: actions/upload-artifact@v4", text.find("jobs:\n  build:"))
    upload_end = text.find("\n      - ", upload_start + 1)
    upload = text[upload_start : upload_end if upload_end != -1 else len(text)]
    if "${{ env.WORK }}/app/entry/.preview" not in upload:
        errors.append("artifact upload does not include the .preview directory")
    if "${{ env.WORK }}/hms-previewer" not in upload:
        errors.append("artifact upload does not include the Previewer system HSP directory")
    if "include-hidden-files: true" not in upload:
        errors.append("artifact upload does not include hidden files")
    if "exclude:" in upload:
        errors.append("artifact upload has exclusions that could omit required files")
    if "-srmPath \"$I/router_map/default/router_map.json\"" not in text:
        errors.append("Previewer command no longer consumes the router map")
    if "-ljPath \"$I/loader/default/loader.json\"" not in text:
        errors.append("Previewer command no longer consumes loader.json")
    if "-hsp \"$W/harmony-wall-work/hms-previewer/systemHsp\"" not in text:
        errors.append("Windows Previewer command no longer consumes the uploaded system HSP")
    if "-pages main_pages" not in text or "-arp \"$I/res/default\"" not in text:
        errors.append("Previewer resource arguments changed; update the handoff contract")
    for argument in ("-srmPath \"$I/router_map/default/router_map.json\"",
                     "-ljPath \"$I/loader/default/loader.json\"",
                     "-pages main_pages", "-arp \"$I/res/default\"",
                     "-hsp \"$WORK/hms-previewer/systemHsp\""):
        if argument not in preview_script:
            errors.append(f"local Previewer setup no longer contains {argument}")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("check", "contract"))
    parser.add_argument("preview_root", type=Path)
    parser.add_argument("--workflow", type=Path, default=WORKFLOW)
    args = parser.parse_args()

    errors = check_output(args.preview_root)
    if args.command == "contract":
        errors.extend(check_workflow(args.workflow))
    if errors:
        print("Previewer handoff check failed:", file=sys.stderr)
        for error in errors:
            print(f"  - {error}", file=sys.stderr)
        return 1
    print(f"Previewer handoff {args.command} passed ({len(REQUIRED_FILES)} files)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
