#!/usr/bin/env python3
"""Exercise the exact allowlist parser embedded in the trusted Apple wall workflow."""

import json
import os
import re
import subprocess
import sys
from pathlib import Path
from textwrap import dedent

root = Path(__file__).resolve().parents[2]
workflow = (root / ".github/workflows/apple-wall.yml").read_text(encoding="utf-8")
match = re.search(r"<<'PY_SUITE_ARGS'\n(.*?)^\s+PY_SUITE_ARGS$", workflow, re.MULTILINE | re.DOTALL)
assert match, "workflow suite-selection parser block is present"
parser_source = dedent(match.group(1))
suite = root / "scripts/parity/suite.json"


def parse(*args: str, device="macos", capture="false", stream="false", chain="false", search_smoke=False) -> dict:
    env = {
        **os.environ,
        "DEVICE": device,
        "CAPTURE_ENABLED": capture,
        "STREAM_ENABLED": stream,
        "CHAIN_ENABLED": chain,
        "SEARCH_SMOKE_ENABLED": str(search_smoke).lower(),
    }
    result = subprocess.run(
        [sys.executable, "-c", parser_source, str(suite), *args],
        text=True,
        capture_output=True,
        check=False,
        env=env,
    )
    if result.returncode:
        raise AssertionError(result.stderr)
    return json.loads(result.stdout)


def rejected(*args: str, device="macos", capture="false", stream="false", chain="false", search_smoke=False) -> None:
    env = {
        **os.environ,
        "DEVICE": device,
        "CAPTURE_ENABLED": capture,
        "STREAM_ENABLED": stream,
        "CHAIN_ENABLED": chain,
        "SEARCH_SMOKE_ENABLED": str(search_smoke).lower(),
    }
    result = subprocess.run(
        [sys.executable, "-c", parser_source, str(suite), *args],
        text=True,
        capture_output=True,
        check=False,
        env=env,
    )
    assert result.returncode != 0


assert parse()["args"] == ["--only", "screens,dpad"]
assert parse()["macParityVisible"] is False
selection = parse("--only", "dpad", "--checks", "home-right,home-down", "--skip-player")
assert selection["args"] == [
    "--only", "dpad", "--checks", "home-right,home-down", "--skip-player"
]
assert selection["macParityVisible"] is True
assert parse("--only", "dpad", "--skip-player")["macParityVisible"] is True
assert parse("--only", "dpad", "--checks", "player-left-edge", "--skip-player")["macParityVisible"] is False
assert parse("--only", "dpad", "--skip-player", capture="true")["macParityVisible"] is False
assert parse("--only", "dpad", "--skip-player", stream="true")["macParityVisible"] is False
assert parse("--only", "dpad", "--skip-player", chain="true")["macParityVisible"] is False
assert parse("--only", "dpad", "--skip-player", device="tvos")["macParityVisible"] is False
assert parse("--only", "dpad", "--player")["macParityVisible"] is False
assert parse("--only", "dpad")["macParityVisible"] is False
assert parse(search_smoke=True)["macParityVisible"] is True
rejected(device="tvos", search_smoke=True)
rejected(capture="true", search_smoke=True)
rejected(stream="true", search_smoke=True)
rejected(chain="true", search_smoke=True)
assert parse("--only", "screens", "--screens", "home,series")["args"] == [
    "--only", "screens", "--screens", "home,series"
]
assert parse("--only", "downloads", "--cases", "movie-download,cancel")["args"] == [
    "--only", "downloads", "--cases", "movie-download,cancel"
]
assert parse("--checks", "movies-grid-right")["args"] == ["--checks", "movies-grid-right", "--only", "screens,dpad"]
assert parse("--only", "dpad", "--player")["args"] == ["--only", "dpad", "--player"]

rejected("--unknown", "dpad")
rejected("--checks", "not-a-suite-check")
rejected("--cases", "not-a-download-case")
rejected("--cases", "movie-download")
rejected("--only", "screens", "--checks", "movies-grid-right")
rejected("--checks", "movies-grid-right;touch")
rejected("--player", "--skip-player")

# The parser runs before the app launch, persists one validated JSON selection, and both suite steps build arrays from it.
argv_setup = '''python_args=("$SUITE_JSON")
if [[ "$SUITE_ARGS" =~ [^[:space:]] ]]; then
  requested=()
  read -r -a requested <<< "$SUITE_ARGS"
  python_args+=("${requested[@]}")
fi'''
argv_start = workflow.index("          python_args=(\"$SUITE_JSON\")")
argv_end = workflow.index("          selection_json=", argv_start)
assert dedent(workflow[argv_start:argv_end]).strip() == argv_setup


def shell_python_args(suite_args: str) -> list[str]:
    result = subprocess.run(
        ["bash", "-c", "set -euo pipefail\n" + argv_setup + '\nprintf "%s\\n" "${python_args[@]}"'],
        text=True,
        capture_output=True,
        check=False,
        env={**os.environ, "SUITE_ARGS": suite_args, "SUITE_JSON": str(suite)},
    )
    assert result.returncode == 0, result.stderr
    return result.stdout.rstrip("\n").split("\n")


assert shell_python_args("") == [str(suite)]
assert shell_python_args("   \t  ") == [str(suite)]
assert shell_python_args("--only dpad --skip-player") == [str(suite), "--only", "dpad", "--skip-player"]

assert workflow.index("- name: Check out the default branch (scripts that see secrets)") < workflow.index("- name: Validate suite selection")
assert workflow.index("- name: Validate suite selection") < workflow.index("- name: Check out the ref under test")
assert workflow.index("- name: Validate suite selection") < workflow.index("- name: Start the simulator, sign in and launch")
assert workflow.count('SUITE_SELECTION: ${{ steps.suite_selection.outputs.selection }}') == 2
assert workflow.count('"${WALL_SUITE_ARGS[@]}"') == 2
array_loaders = re.findall(r"^\s*(while IFS= read -r arg; do WALL_SUITE_ARGS\+=\(\"\$arg\"\); done < <\(python3 -c .*\))$", workflow, re.MULTILINE)
assert len(array_loaders) == 2
for loader in array_loaders:
    reconstructed = subprocess.run(
        ["bash", "-c", f'set -euo pipefail\nWALL_SUITE_ARGS=()\n{loader}\nprintf "%s\\n" "${{WALL_SUITE_ARGS[@]}}"'],
        text=True,
        capture_output=True,
        check=False,
        env={**os.environ, "SUITE_SELECTION": json.dumps(selection, separators=(",", ":"))},
    )
    assert reconstructed.returncode == 0, reconstructed.stderr
    assert reconstructed.stdout.rstrip("\n").split("\n") == selection["args"]
assert "MAC_PARITY_VISIBLE:" not in workflow
assert "printf 'MAC_PARITY_VISIBLE=%s\\n' \"$mac_parity_visible\" >> \"$GITHUB_ENV\"" in workflow
assert 'search_smoke:' in workflow and 'type: boolean' in workflow
assert 'node apple/search-results-smoke.mjs --query "$SEARCH_QUERY"' in workflow
assert 'ref: ${{ github.event.repository.default_branch }}' in workflow
assert 'SEARCH_SMOKE_ENABLED: ${{ inputs.search_smoke }}' in workflow
assert workflow.count("node suite-run.mjs") == 2
assert '${{ inputs.suite_args ||' not in workflow
assert 'grep -oE -e' not in workflow

# Explicit non-stream suite runs must surface failed captures after cleanup.
gate_name = "- name: Require successful explicit suite captures"
gate_start = workflow.index(gate_name)
gate_block = workflow[gate_start:]
assert "github.event_name == 'workflow_dispatch'" in gate_block
assert "inputs.suite_args != ''" in gate_block
assert "!inputs.stream" in gate_block
assert "matrix.device == 'tvos' || matrix.device == 'macos'" in gate_block
assert workflow.index("- name: Delete the simulator") < gate_start
assert "WEBREF_OUTCOME: ${{ steps.webref.outcome }}" in gate_block
assert "SUITE_OUTCOME: ${{ steps.suite.outcome }}" in gate_block
assert '[[ "$WEBREF_OUTCOME" != success || "$SUITE_OUTCOME" != success ]]' in gate_block
gate_run = re.search(r"^        run: \|\n((?:^          .*\n)+)", gate_block, re.MULTILINE)
assert gate_run, "capture outcome gate has a shell body"
gate_script = dedent(gate_run.group(1))


def gate(webref: str, suite: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["bash", "-c", gate_script],
        text=True,
        capture_output=True,
        check=False,
        env={**os.environ, "WEBREF_OUTCOME": webref, "SUITE_OUTCOME": suite},
    )


assert gate("success", "success").returncode == 0
for failed in (("failure", "success"), ("success", "failure"), ("skipped", "success")):
    result = gate(*failed)
    assert result.returncode != 0
    assert "explicit suite capture failed" in result.stdout

print("workflow suite-selection and visibility checks passed")
