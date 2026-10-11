namespace Playarr.Tizen.Logic;

public sealed record NavItem(string Id, string Label, string Route, string Icon, int Group);

/// <summary>The nav rail: three groups plus the profile chip, in the web's order (App.tsx / .app-nav).</summary>
public static class NavModel
{
    public static readonly IReadOnlyList<NavItem> Items = new[]
    {
        new NavItem("downloads", "Downloads", "/downloads", "downloads", 0),
        new NavItem("search", "Search", "/search", "search", 0),
        new NavItem("home", "Home", "/", "home", 1),
        new NavItem("series", "Series", "/series", "series", 1),
        new NavItem("movies", "Movies", "/movies", "movies", 1),
        new NavItem("music", "Music", "/music", "music", 1),
        new NavItem("playlists", "Playlists", "/playlists", "playlists", 2),
        new NavItem("watchlist", "Watchlist", "/watchlist", "watchlist", 2),
        new NavItem("requests", "Requests", "/requests", "watchlist", 2),
        new NavItem("calendar", "Calendar", "/calendar", "calendar", 2),
    };

    /// <summary>The nav route that owns a page route (detail pages belong to their library).</summary>
    public static string Owner(string route)
    {
        var first = "/" + route.TrimStart('/').Split('/', '?')[0];
        return Items.Any(i => i.Route == first) ? first : "/";
    }
}
