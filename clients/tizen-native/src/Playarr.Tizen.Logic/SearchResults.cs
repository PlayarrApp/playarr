using Playarr.Core.Models;

namespace Playarr.Tizen.Logic;

public sealed record SearchResultTarget(Work? Work = null, PlaylistInfo? Playlist = null, DiscoveryTitle? Game = null);

/// <summary>Combines local catalog, playlist and game matches using the web Search type rules.</summary>
public static class SearchResults
{
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
