"""Validation for screen selections accepted by the Harmony wall."""

TV_SCREEN_IDS = ("home", "movies", "film-detail", "series-detail")
PHONE_SCREEN_IDS = ("home", "movies", "film-detail", "series-detail")


def _parse_screens(value: str, allowed: tuple[str, ...], name: str):
    """Return None for the legacy full set, otherwise a validated ordered subset."""
    value = value.strip()
    if value == "all":
        return None
    requested = [screen.strip() for screen in value.split(",")]
    if (not requested or any(not screen for screen in requested)
            or len(requested) != len(set(requested))
            or any(screen not in allowed for screen in requested)):
        raise ValueError(name + " must be all or a comma-separated list of: " + ", ".join(allowed))
    return requested


def parse_tv_screens(value: str):
    return _parse_screens(value, TV_SCREEN_IDS, "TV_SCREENS")


def parse_phone_screens(value: str):
    """Selected phone mode is limited to safe screens and cannot route to player/actions."""
    return _parse_screens(value, PHONE_SCREEN_IDS, "PHONE_SCREENS")


def player_is_skipped(requested: list[str] | None, skip_player: bool) -> bool:
    """A selected subset never visits player; the full set follows its explicit flag."""
    return requested is not None or skip_player
