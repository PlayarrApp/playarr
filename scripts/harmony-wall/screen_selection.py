"""Validation for the TV screen selection accepted by the Harmony wall."""

import re

TV_SCREEN_IDS = ("home", "movies", "film-detail", "series-detail")


def parse_tv_screens(value: str):
    """Return None for the legacy full set, otherwise a validated ordered subset."""
    value = value.strip()
    if value == "all":
        return None
    requested = [screen.strip() for screen in value.split(",")]
    if (not requested or any(not screen for screen in requested)
            or len(requested) != len(set(requested))
            or any(screen not in TV_SCREEN_IDS for screen in requested)):
        raise ValueError("TV_SCREENS must be all or a comma-separated list of: " + ", ".join(TV_SCREEN_IDS))
    return requested


def player_is_skipped(requested: list[str] | None, skip_player: bool) -> bool:
    """A selected subset never visits player; the full set follows its explicit flag."""
    return requested is not None or skip_player


def phone_core_only_requested(device: str, requested: bool) -> bool:
    """Allow the bounded core capture mode only for an explicit phone run."""
    if requested and device != "phone":
        raise ValueError("PHONE_CORE_ONLY is supported only for phone captures")
    return requested


def phone_core_manifest_selection(requested: list[str], captured: list[str], skip_player: bool = False) -> tuple[dict, list[str]]:
    """Describe the phone core selection and report every absent requested screen."""
    skipped = ["player-controls"] if skip_player and "player-controls" in requested else []
    selected = [screen for screen in requested if screen not in skipped]
    captured_set = set(captured)
    present = [screen for screen in selected if screen in captured_set]
    missing = [screen for screen in selected if screen not in captured_set]
    return ({"mode": "phone-core-only", "skip_player": bool(skipped), "requested": selected,
             "skipped": skipped, "captured": present}, missing)


def player_fixture_file(suite: dict) -> str:
    """Select the pinned player fixture when its suite metadata expects playback."""
    fixtures = suite.get("performance") if isinstance(suite, dict) else None
    fixture = fixtures[0] if isinstance(fixtures, list) and fixtures else None
    if not isinstance(fixture, dict):
        raise ValueError("player chrome requires the configured playing fixture")
    expected = fixture.get("expect")
    file_path = fixture.get("file")
    if (not isinstance(expected, dict) or expected.get("state") != "playing"
            or fixture.get("nowPlaying") is not True or not isinstance(file_path, str) or not file_path):
        raise ValueError("player chrome requires the configured playing fixture")
    return file_path


def player_fixture_selection(suite: dict, override: str | None = None) -> tuple[str, str]:
    """Choose a private runtime fixture override or the unchanged suite default.

    The override is an opaque media-file UUID supplied by the capture environment.
    Only its generic source is intended for manifests; callers must not log it.
    """
    selected = override.strip() if isinstance(override, str) else ""
    if selected:
        if re.fullmatch(r"[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}", selected) is None:
            raise ValueError("player fixture override must be a UUID")
        return selected, "direct-play-fixture-override"
    return player_fixture_file(suite), "suite-default"
