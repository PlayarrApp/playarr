"""Validation for the TV screen selection accepted by the Harmony wall."""

TV_SCREEN_IDS = ("home", "movies", "series", "music", "film-detail", "series-detail")
TV_LIBRARY_ROUTES = {
    "home": "home",
    "movies": "library:movie",
    "series": "library:series",
    "music": "library:artist",
}


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


def selected_library_route(screen: str) -> str | None:
    """Return the native route for a selected library screen, or None for a detail route."""
    return TV_LIBRARY_ROUTES.get(screen)
