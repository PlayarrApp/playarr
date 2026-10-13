using Playarr.Core.Models;

namespace Playarr.Tizen.Logic;

public sealed record SearchResultTarget(Work? Work = null, PlaylistInfo? Playlist = null, DiscoveryTitle? Game = null);

public sealed record SearchPlaylistPreview(string Eyebrow, string Title)
{
    public int MaxTitleLines => 6;
    public string DisplayTitle => Title.Replace("-", "-\u200B", StringComparison.Ordinal);
}

/// <summary>Search focus preserved while a result page is opened and the Search route is recreated on Back.</summary>
public sealed record SearchFocusState(int ResultIndex, float ScrollOffset)
{
    public int ResolveResultIndex(int resultCount) => ResultIndex >= 0 && ResultIndex < resultCount ? ResultIndex : -1;
}

/// <summary>Combines local catalog, playlist and game matches using the web Search type rules.</summary>
public static class SearchResults
{
    public static SearchPlaylistPreview? PlaylistPreview(SearchResultTarget? selected)
    {
        if (selected?.Playlist is not { } playlist) return null;
        return new SearchPlaylistPreview(playlist.IsSystem ? "System playlist" : "Playlist", playlist.Name);
    }

    public static IReadOnlyList<SearchResultTarget> Build(
        string query,
        string mediaType,
        IEnumerable<Work> works,
        IEnumerable<PlaylistInfo> playlists,
        IEnumerable<DiscoveryTitle> games)
    {
        var results = new List<SearchResultTarget>();
        var wantedKind = mediaType switch
        {
            "movie" => WorkKind.Movie,
            "series" => WorkKind.Series,
            "site" => WorkKind.Site,
            "artist" => WorkKind.Artist,
            _ => (WorkKind?)null,
        };

        if (mediaType is not ("playlist" or "game"))
        {
            foreach (var work in works)
            {
                if (work.Kind is not (WorkKind.Movie or WorkKind.Series or WorkKind.Site or WorkKind.Artist)) continue;
                if (wantedKind is null || work.Kind == wantedKind) results.Add(new SearchResultTarget(Work: work));
            }
        }

        if (mediaType is "all" or "playlist")
        {
            foreach (var playlist in playlists)
                if (playlist.Name.Contains(query, StringComparison.CurrentCultureIgnoreCase))
                    results.Add(new SearchResultTarget(Playlist: playlist));
        }

        if (mediaType == "game")
        {
            foreach (var game in games) results.Add(new SearchResultTarget(Game: game));
        }

        return results;
    }
}
