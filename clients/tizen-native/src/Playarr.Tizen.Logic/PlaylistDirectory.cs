using System.Net.Http;
using Newtonsoft.Json;
using Playarr.Core.Models;
using Playarr.Core.Networking;

namespace Playarr.Tizen.Logic;

public sealed record PlaylistTreeEntry(PlaylistInfo Playlist, Guid? ParentPlaylistId);
public sealed record PlaylistItemFocus(Guid TrackId, Guid WorkId);

public sealed record PlaylistRouteState(Guid? PlaylistId = null, Guid? TrackId = null)
{
    public string ToRoute()
    {
        if (PlaylistId is not { } playlistId) return "/playlists";
        var route = "/playlists?playlist=" + playlistId.ToString("D");
        return TrackId is { } trackId ? route + "&track=" + trackId.ToString("D") : route;
    }

    public static PlaylistRouteState Parse(string route)
    {
        Guid? playlist = null;
        Guid? track = null;
        var queryIndex = route.IndexOf('?');
        if (queryIndex < 0) return new PlaylistRouteState();
        foreach (var part in route[(queryIndex + 1)..].Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            var pair = part.Split('=', 2);
            if (pair.Length != 2) continue;
            var key = Uri.UnescapeDataString(pair[0].Replace('+', ' '));
            var value = Uri.UnescapeDataString(pair[1].Replace('+', ' '));
            if (key == "playlist" && Guid.TryParse(value, out var playlistId)) playlist = playlistId;
            if (key == "track" && Guid.TryParse(value, out var trackId)) track = trackId;
        }
        return new PlaylistRouteState(playlist, track);
    }

    public PlaylistRouteState Back() => TrackId is not null
        ? this with { TrackId = null }
        : PlaylistId is not null
            ? new PlaylistRouteState()
            : this;
}

/// <summary>Root, child and route rules shared by the native directory and Search activation.</summary>
public static class PlaylistDirectoryModel
{
    public static IReadOnlyList<PlaylistTreeEntry> Roots(IEnumerable<PlaylistTreeEntry> entries)
    {
        var all = entries.ToList();
        var byId = all.ToDictionary(entry => entry.Playlist.Id);
        return Sort(all.Where(entry => entry.ParentPlaylistId is not { } parentId || !byId.ContainsKey(parentId)));
    }

    public static IReadOnlyList<PlaylistTreeEntry> Children(IEnumerable<PlaylistTreeEntry> entries, Guid parentId) =>
        Sort(entries.Where(entry => entry.ParentPlaylistId == parentId));

    /// <summary>The selected playlist followed by every descendant track in natural sibling order.</summary>
    public static IReadOnlyList<PlaylistTreeEntry> DetailTracks(IEnumerable<PlaylistTreeEntry> entries, Guid rootId)
    {
        var all = entries.ToList();
        var byId = all.ToDictionary(entry => entry.Playlist.Id);
        if (!byId.TryGetValue(rootId, out var root)) return Array.Empty<PlaylistTreeEntry>();
        var result = new List<PlaylistTreeEntry> { root };
        var visited = new HashSet<Guid> { rootId };
        void AddChildren(Guid parentId)
        {
            foreach (var child in Children(all, parentId))
            {
                if (!visited.Add(child.Playlist.Id)) continue;
                result.Add(child);
                AddChildren(child.Playlist.Id);
            }
        }
        AddChildren(rootId);
        return result;
    }

    /// <summary>Writable parent choices for a playlist, matching the web picker constraints.</summary>
    public static IReadOnlyList<PlaylistTreeEntry> EligibleParents(IEnumerable<PlaylistTreeEntry> entries, Guid? playlistId, string mediaType)
    {
        var all = entries.ToList();
        var excluded = new HashSet<Guid>();
        if (playlistId is { } id)
        {
            excluded.Add(id);
            void AddDescendants(Guid parentId)
            {
                foreach (var child in Children(all, parentId))
                {
                    if (!excluded.Add(child.Playlist.Id)) continue;
                    AddDescendants(child.Playlist.Id);
                }
            }
            AddDescendants(id);
        }
        return Sort(all.Where(entry => !entry.Playlist.IsSystem
            && !excluded.Contains(entry.Playlist.Id)
            && string.Equals(entry.Playlist.MediaType, mediaType, StringComparison.OrdinalIgnoreCase)));
    }

    public static int ResolveFocusIndex(IReadOnlyList<PlaylistItemFocus> items, PlaylistItemFocus? saved, int fallbackIndex)
    {
        if (saved is { } focus)
        {
            var match = items.ToList().FindIndex(item => item == focus);
            if (match >= 0) return match;
        }
        return fallbackIndex >= 0 && fallbackIndex < items.Count ? fallbackIndex : items.Count == 0 ? -1 : 0;
    }

    public static PlaylistRouteState RouteForSelection(IEnumerable<PlaylistTreeEntry> entries, Guid selectedId)
    {
        var all = entries.ToList();
        var byId = all.ToDictionary(entry => entry.Playlist.Id);
        if (!byId.TryGetValue(selectedId, out var selected)) return new PlaylistRouteState(selectedId);
        var root = selected;
        var visited = new HashSet<Guid> { selected.Playlist.Id };
        while (root.ParentPlaylistId is { } parentId)
        {
            if (!visited.Add(parentId) || !byId.TryGetValue(parentId, out var parent)) break;
            root = parent;
        }
        return new PlaylistRouteState(root.Playlist.Id, root.Playlist.Id == selected.Playlist.Id ? null : selected.Playlist.Id);
    }

    public static PlaylistRouteState NormalizeRoute(IEnumerable<PlaylistTreeEntry> entries, PlaylistRouteState route)
    {
        if (route.PlaylistId is not { } playlistId) return new PlaylistRouteState();
        var all = entries.ToList();
        if (route.TrackId is { } trackId && all.Any(entry => entry.Playlist.Id == trackId))
            return RouteForSelection(all, trackId);
        if (all.Any(entry => entry.Playlist.Id == playlistId))
            return RouteForSelection(all, playlistId);
        return new PlaylistRouteState(playlistId);
    }

    private static IReadOnlyList<PlaylistTreeEntry> Sort(IEnumerable<PlaylistTreeEntry> entries) =>
        entries.OrderBy(entry => entry.Playlist.Name, NaturalNameComparer.Instance).ToList();

    private sealed class NaturalNameComparer : IComparer<string>
    {
        public static readonly NaturalNameComparer Instance = new();

        public int Compare(string? left, string? right)
        {
            left ??= string.Empty;
            right ??= string.Empty;
            var li = 0;
            var ri = 0;
            while (li < left.Length && ri < right.Length)
            {
                if (char.IsAsciiDigit(left[li]) && char.IsAsciiDigit(right[ri]))
                {
                    var le = li;
                    var re = ri;
                    while (le < left.Length && char.IsAsciiDigit(left[le])) le++;
                    while (re < right.Length && char.IsAsciiDigit(right[re])) re++;
                    var lz = li;
                    var rz = ri;
                    while (lz < le - 1 && left[lz] == '0') lz++;
                    while (rz < re - 1 && right[rz] == '0') rz++;
                    var length = (le - lz).CompareTo(re - rz);
                    if (length != 0) return length;
                    var digits = string.Compare(left, lz, right, rz, le - lz, StringComparison.Ordinal);
                    if (digits != 0) return digits;
                    var zeros = (le - li).CompareTo(re - ri);
                    if (zeros != 0) return zeros;
                    li = le;
                    ri = re;
                    continue;
                }
                var chars = char.ToUpperInvariant(left[li]).CompareTo(char.ToUpperInvariant(right[ri]));
                if (chars != 0) return chars;
                li++;
                ri++;
            }
            return (left.Length - li).CompareTo(right.Length - ri);
        }
    }
}

/// <summary>Loads the playlist response once, including the parent relation omitted by the shared Core model.</summary>
public sealed class PlaylistDirectoryApi(IPlayarrApiClient api, HttpClient http)
{
    private sealed class PlaylistResponseDto
    {
        [JsonProperty("id")] public string? Id { get; set; }
        [JsonProperty("name")] public string Name { get; set; } = string.Empty;
        [JsonProperty("is_system")] public bool IsSystem { get; set; }
        [JsonProperty("media_type")] public string MediaType { get; set; } = string.Empty;
        [JsonProperty("parent_playlist_id")] public string? ParentPlaylistId { get; set; }
    }

    public async Task<IReadOnlyList<PlaylistTreeEntry>> LoadAsync(CancellationToken cancellationToken = default)
    {
        var uri = api.ResolveUrl("/api/v1/playlists") ?? throw new InvalidOperationException("The Playlists endpoint URL is invalid.");
        using var request = new HttpRequestMessage(HttpMethod.Get, uri);
        foreach (var header in await api.GetPlaybackRequestHeadersAsync(cancellationToken).ConfigureAwait(false))
            request.Headers.TryAddWithoutValidation(header.Key, header.Value);
        using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken).ConfigureAwait(false);
        response.EnsureSuccessStatusCode();
        var json = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
        return ParseResponse(json);
    }

    public Task CreateAsync(string name, string mediaType, Guid? parentPlaylistId, CancellationToken cancellationToken = default) =>
        SendAsync(HttpMethod.Post, "/api/v1/playlists", new
        {
            name,
            parent_playlist_id = parentPlaylistId,
            is_system = false,
            media_type = mediaType,
        }, cancellationToken);

    public Task UpdateAsync(Guid playlistId, string name, Guid? parentPlaylistId, CancellationToken cancellationToken = default) =>
        SendAsync(HttpMethod.Put, $"/api/v1/playlists/{playlistId:D}", new
        {
            name,
            parent_playlist_id = parentPlaylistId,
        }, cancellationToken);

    public Task DeleteAsync(Guid playlistId, CancellationToken cancellationToken = default) =>
        SendAsync(HttpMethod.Delete, $"/api/v1/playlists/{playlistId:D}", null, cancellationToken);

    private async Task SendAsync(HttpMethod method, string path, object? body, CancellationToken cancellationToken)
    {
        var uri = api.ResolveUrl(path) ?? throw new InvalidOperationException("The Playlists endpoint URL is invalid.");
        using var request = new HttpRequestMessage(method, uri);
        foreach (var header in await api.GetPlaybackRequestHeadersAsync(cancellationToken).ConfigureAwait(false))
            request.Headers.TryAddWithoutValidation(header.Key, header.Value);
        if (body is not null)
            request.Content = new StringContent(JsonConvert.SerializeObject(body), System.Text.Encoding.UTF8, "application/json");
        using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken).ConfigureAwait(false);
        response.EnsureSuccessStatusCode();
    }

    public static IReadOnlyList<PlaylistTreeEntry> ParseResponse(string json)
    {
        var rows = JsonConvert.DeserializeObject<List<PlaylistResponseDto>>(json)
            ?? throw new JsonSerializationException("The Playlists response is empty.");
        var result = new List<PlaylistTreeEntry>();
        foreach (var row in rows)
        {
            if (!Guid.TryParse(row.Id, out var id)) continue;
            var parentId = Guid.TryParse(row.ParentPlaylistId, out var parsedParent) ? parsedParent : (Guid?)null;
            var playlist = new PlaylistInfo
            {
                Id = id,
                Name = row.Name,
                IsSystem = row.IsSystem,
                MediaType = row.MediaType,
            };
            result.Add(new PlaylistTreeEntry(playlist, parentId));
        }
        return result;
    }
}
