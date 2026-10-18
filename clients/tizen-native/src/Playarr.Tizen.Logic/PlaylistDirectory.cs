using System.Net.Http;
using Newtonsoft.Json;
using Playarr.Core.Models;
using Playarr.Core.Networking;

namespace Playarr.Tizen.Logic;

public sealed record PlaylistTreeEntry(PlaylistInfo Playlist, Guid? ParentPlaylistId);
public sealed record PlaylistItemFocus(Guid TrackId, Guid WorkId);

public enum PlaylistVisibility { All, Personal, Shared }
public enum PlaylistOrder { Ascending, Descending }

public sealed record PlaylistRouteState(
    Guid? PlaylistId = null,
    Guid? TrackId = null,
    PlaylistVisibility Visibility = PlaylistVisibility.All,
    PlaylistOrder Order = PlaylistOrder.Ascending,
    string? Panel = null)
{
    public string ToRoute()
    {
        var query = new List<string>();
        if (PlaylistId is { } playlistId) query.Add("playlist=" + playlistId.ToString("D"));
        if (Visibility != PlaylistVisibility.All) query.Add("visibility=" + Visibility.ToString().ToLowerInvariant());
        if (Order == PlaylistOrder.Descending) query.Add("order=desc");
        if (Panel is "create" or "filters") query.Add("panel=" + Panel);
        if (TrackId is { } trackId) query.Add("track=" + trackId.ToString("D"));
        return "/playlists" + (query.Count == 0 ? "" : "?" + string.Join("&", query));
    }

    public static PlaylistRouteState Parse(string route)
    {
        Guid? playlist = null;
        Guid? track = null;
        var visibility = PlaylistVisibility.All;
        var order = PlaylistOrder.Ascending;
        string? panel = null;
        var queryIndex = route.IndexOf('?');
        if (queryIndex >= 0) foreach (var part in route[(queryIndex + 1)..].Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            var pair = part.Split('=', 2);
            if (pair.Length != 2) continue;
            var key = Uri.UnescapeDataString(pair[0].Replace('+', ' '));
            var value = Uri.UnescapeDataString(pair[1].Replace('+', ' '));
            if (key == "playlist" && Guid.TryParse(value, out var playlistId)) playlist = playlistId;
            if (key == "track" && Guid.TryParse(value, out var trackId)) track = trackId;
            if (key == "visibility") visibility = value switch
            {
                "personal" => PlaylistVisibility.Personal,
                "shared" => PlaylistVisibility.Shared,
                _ => PlaylistVisibility.All,
            };
            if (key == "order") order = value == "desc" ? PlaylistOrder.Descending : PlaylistOrder.Ascending;
            if (key == "panel" && (value is "create" or "filters")) panel = value;
        }
        return new PlaylistRouteState(playlist, track, visibility, order, panel);
    }

    public PlaylistRouteState Back() => Panel is not null
        ? this with { Panel = null }
        : TrackId is not null
        ? this with { TrackId = null }
        : PlaylistId is not null
            ? new PlaylistRouteState(Visibility: Visibility, Order: Order)
            : this;
}

/// <summary>Root, child and route rules shared by the native directory and Search activation.</summary>
public static class PlaylistDirectoryModel
{
    public const int CreateActionIndex = 0;
    public const int FiltersActionIndex = 1;

    /// <summary>Returns the paired vertical neighbour in the directory action column, leaving other moves geometric.</summary>
    public static int? ActionColumnNeighbor(int actionIndex, bool moveDown) => (actionIndex, moveDown) switch
    {
        (CreateActionIndex, true) => FiltersActionIndex,
        (FiltersActionIndex, false) => CreateActionIndex,
        _ => null,
    };

    /// <summary>Chooses the nearest directory card by the web shell action column's edge-distance rule.</summary>
    public static int? NearestDirectoryCardIndex(Box from, IReadOnlyList<Box> cards)
    {
        var bestIndex = -1;
        var bestDistance = float.PositiveInfinity;
        var best = default(Box);
        for (var index = 0; index < cards.Count; index++)
        {
            var candidate = cards[index];
            var dx = Math.Max(0f, Math.Max(candidate.X - (from.X + from.Width), from.X - (candidate.X + candidate.Width)));
            var dy = Math.Max(0f, Math.Max(candidate.Y - (from.Y + from.Height), from.Y - (candidate.Y + candidate.Height)));
            var distance = MathF.Sqrt(dx * dx + dy * dy);
            if (bestIndex < 0 || distance < bestDistance - 0.5f ||
                (Math.Abs(distance - bestDistance) <= 0.5f &&
                    (candidate.Y < best.Y || (candidate.Y == best.Y && candidate.X < best.X))))
            {
                bestIndex = index;
                bestDistance = distance;
                best = candidate;
            }
        }
        return bestIndex >= 0 ? bestIndex : null;
    }

    /// <summary>Cycles the None option and parent indices, returning a valid index for every parent count.</summary>
    public static int CycleParentIndex(int currentIndex, int parentCount, int direction)
    {
        if (parentCount <= 0) return -1;
        if (currentIndex < -1 || currentIndex >= parentCount) currentIndex = -1;
        var optionCount = parentCount + 1;
        var next = (currentIndex + 1 + Math.Sign(direction) + optionCount) % optionCount;
        return next - 1;
    }

    public static IReadOnlyList<PlaylistTreeEntry> Roots(IEnumerable<PlaylistTreeEntry> entries)
    {
        var all = entries.ToList();
        var byId = all.ToDictionary(entry => entry.Playlist.Id);
        return Sort(all.Where(entry => entry.ParentPlaylistId is not { } parentId || !byId.ContainsKey(parentId)));
    }

    public static IReadOnlyList<PlaylistTreeEntry> Children(IEnumerable<PlaylistTreeEntry> entries, Guid parentId) =>
        Sort(entries.Where(entry => entry.ParentPlaylistId == parentId));

    /// <summary>Applies the playlist directory's Show and Order query filters to top-level playlists.</summary>
    public static IReadOnlyList<PlaylistTreeEntry> DirectoryRoots(
        IEnumerable<PlaylistTreeEntry> entries,
        PlaylistVisibility visibility,
        PlaylistOrder order)
    {
        var roots = Roots(entries).Where(entry => visibility switch
        {
            PlaylistVisibility.Personal => !entry.Playlist.IsSystem,
            PlaylistVisibility.Shared => entry.Playlist.IsSystem,
            _ => true,
        });
        return order == PlaylistOrder.Descending ? roots.Reverse().ToList() : roots.ToList();
    }

    /// <summary>Personal top-level parents of the same media type, excluding a playlist and its descendants.</summary>
    public static IReadOnlyList<PlaylistTreeEntry> EligibleParents(
        IEnumerable<PlaylistTreeEntry> entries,
        string mediaType,
        Guid? excludedPlaylistId = null)
    {
        var all = entries.ToList();
        var excluded = excludedPlaylistId is { } id
            ? new HashSet<Guid>(new[] { id }.Concat(Descendants(all, id).Select(entry => entry.Playlist.Id)))
            : new HashSet<Guid>();
        return Roots(all).Where(entry =>
            !entry.Playlist.IsSystem &&
            string.Equals(entry.Playlist.MediaType, mediaType, StringComparison.OrdinalIgnoreCase) &&
            !excluded.Contains(entry.Playlist.Id)).ToList();
    }

    /// <summary>Child playlists in the web directory's depth-first order, with cycles ignored.</summary>
    public static IReadOnlyList<PlaylistTreeEntry> Descendants(IEnumerable<PlaylistTreeEntry> entries, Guid playlistId)
    {
        var all = entries.ToList();
        var descendants = new List<PlaylistTreeEntry>();
        var visited = new HashSet<Guid> { playlistId };
        void Visit(Guid parentId)
        {
            foreach (var child in Children(all, parentId))
            {
                if (!visited.Add(child.Playlist.Id)) continue;
                descendants.Add(child);
                Visit(child.Playlist.Id);
            }
        }
        Visit(playlistId);
        return descendants;
    }

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
        if (route.PlaylistId is not { } playlistId)
            return new PlaylistRouteState(Visibility: route.Visibility, Order: route.Order, Panel: route.Panel);
        var all = entries.ToList();
        if (route.TrackId is { } trackId && all.Any(entry => entry.Playlist.Id == trackId))
            return PreserveQuery(RouteForSelection(all, trackId), route);
        if (all.Any(entry => entry.Playlist.Id == playlistId))
            return PreserveQuery(RouteForSelection(all, playlistId), route);
        return new PlaylistRouteState(playlistId, Visibility: route.Visibility, Order: route.Order, Panel: route.Panel);
    }

    private static PlaylistRouteState PreserveQuery(PlaylistRouteState normalized, PlaylistRouteState original) =>
        normalized with { Visibility = original.Visibility, Order = original.Order, Panel = original.Panel };

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

/// <summary>Selects the three visible directory covers in playlist item and descendant order.</summary>
public static class PlaylistCoverSelection
{
    public const int Limit = 3;

    public sealed class Collector
    {
        private readonly HashSet<Guid> _seen = new();
        private readonly List<Work> _works = new(Limit);
        public IReadOnlyList<Work> Works => _works;
        public bool IsComplete => _works.Count >= Limit;

        /// <returns>True when the three-cover limit has been reached.</returns>
        public bool Add(Work work)
        {
            if (!HasArtwork(work) || !_seen.Add(work.Id)) return IsComplete;
            _works.Add(work);
            return IsComplete;
        }
    }

    public static IReadOnlyList<Work> Select(
        IEnumerable<PlaylistTreeEntry> entries,
        Guid playlistId,
        IReadOnlyDictionary<Guid, IReadOnlyList<Work>> orderedWorksByPlaylist)
    {
        var selected = new Collector();
        var byId = entries.ToDictionary(entry => entry.Playlist.Id);
        if (!byId.ContainsKey(playlistId)) return selected.Works;

        foreach (var id in new[] { playlistId }.Concat(PlaylistDirectoryModel.Descendants(byId.Values, playlistId).Select(entry => entry.Playlist.Id)))
        {
            if (!orderedWorksByPlaylist.TryGetValue(id, out var works)) continue;
            foreach (var work in works)
            {
                if (selected.Add(work)) return selected.Works;
            }
        }
        return selected.Works;
    }

    public static bool HasArtwork(Work work) =>
        ArtworkPaths.Path(work, ImageKind.Poster) is not null || ArtworkPaths.Path(work, ImageKind.Backdrop) is not null;
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

    public async Task<PlaylistTreeEntry> CreateAsync(
        string name,
        Guid? parentPlaylistId,
        string mediaType,
        CancellationToken cancellationToken = default)
    {
        var uri = api.ResolveUrl("/api/v1/playlists") ?? throw new InvalidOperationException("The Playlists endpoint URL is invalid.");
        using var request = new HttpRequestMessage(HttpMethod.Post, uri)
        {
            Content = new StringContent(CreateRequestJson(name, parentPlaylistId, mediaType), System.Text.Encoding.UTF8, "application/json"),
        };
        foreach (var header in await api.GetPlaybackRequestHeadersAsync(cancellationToken).ConfigureAwait(false))
            request.Headers.TryAddWithoutValidation(header.Key, header.Value);
        using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken).ConfigureAwait(false);
        response.EnsureSuccessStatusCode();
        var row = JsonConvert.DeserializeObject<PlaylistResponseDto>(await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false))
            ?? throw new JsonSerializationException("The created playlist response is empty.");
        if (!Guid.TryParse(row.Id, out var id)) throw new JsonSerializationException("The created playlist id is invalid.");
        return new PlaylistTreeEntry(new PlaylistInfo { Id = id, Name = row.Name, IsSystem = row.IsSystem, MediaType = row.MediaType }, parentPlaylistId);
    }

    public static string CreateRequestJson(string name, Guid? parentPlaylistId, string mediaType) =>
        new Newtonsoft.Json.Linq.JObject
        {
            ["name"] = name,
            ["parent_playlist_id"] = parentPlaylistId?.ToString("D"),
            ["is_system"] = false,
            ["media_type"] = mediaType,
        }.ToString(Formatting.None);

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
