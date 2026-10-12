using Playarr.Core.Models;

namespace Playarr.Tizen;

/// <summary>Route table: web routes to native pages.</summary>
internal static class Pages
{
    public static IPage? Create(AppEnv env, string route) => route switch
    {
        "/" => new HomeScreen(env),
        "/movies" => new LibraryScreen(env, WorkKind.Movie, "Movies", "/movies"),
        "/series" => new LibraryScreen(env, WorkKind.Series, "Series", "/series"),
        _ when route.StartsWith("/calendar") => CalendarFor(env, route),
        "/settings" => new SettingsScreen(env),
        _ when route == "/search" || route.StartsWith("/search?", StringComparison.Ordinal) => SearchFor(env, route),
        "/profiles" => new ProfilesScreen(env),
        "/music" => new LibraryScreen(env, WorkKind.Artist, "Music", "/music"),
        _ when route.StartsWith("/player/") => PlayerFor(env, route),
        _ when route.StartsWith("/series/") && Guid.TryParse(route[8..], out var series) => new SeriesDetailScreen(env, series),
        _ when route.StartsWith("/movies/") && Guid.TryParse(route[8..], out var movie) => new DetailScreen(env, movie),
        "/downloads" => new DownloadsScreen(env),
        _ when route == "/playlists" || route.StartsWith("/playlists?", StringComparison.Ordinal) => new PlaylistsScreen(env, route),
        "/watchlist" => new UnavailableScreen(env, "Watchlist", route),
        "/requests" => new UnavailableScreen(env, "Requests", route),
        _ => null,
    };

    private static IPage? PlayerFor(AppEnv env, string route)
    {
        var parts = route[8..].Split('?');
        if (!Guid.TryParse(parts[0], out var file)) return null;
        long start = 0; string? local = null;
        foreach (var q in parts.Skip(1).SelectMany(p => p.Split('&')))
        {
            if (q.StartsWith("t=")) long.TryParse(q[2..], out start);
            else if (q.StartsWith("local=")) local = q[6..];
        }
        return new PlayerScreen(env, file, start, local);
    }

    private static IPage CalendarFor(AppEnv env, string route)
    {
        var view = route.Contains("view=month") ? Playarr.Core.Models.CalendarView.Month : route.Contains("view=week") ? Playarr.Core.Models.CalendarView.Week : Playarr.Core.Models.CalendarView.Agenda;
        var screen = new CalendarScreen(env, view);
        if (route.Contains("panel=filters")) screen.OpenFiltersFromRoute();
        return screen;
    }

    private static IPage SearchFor(AppEnv env, string route)
    {
        var screen = new SearchScreen(env, route);
        if (route.Contains("panel=filters", StringComparison.Ordinal)) screen.OpenFiltersFromRoute();
        return screen;
    }
}
