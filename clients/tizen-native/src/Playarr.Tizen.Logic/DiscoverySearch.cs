using Playarr.Core.Models;
using Playarr.Core.Networking;
using Newtonsoft.Json;

namespace Playarr.Tizen.Logic;

/// <summary>The relevant part of GET /api/v1/discover for Search.</summary>
public sealed class DiscoverySearchResponse
{
    [JsonProperty("titles")] public IList<DiscoveryTitle> Titles { get; set; } = new List<DiscoveryTitle>();
    [JsonProperty("providers")] public IList<DiscoveryProviderStatus> Providers { get; set; } = new List<DiscoveryProviderStatus>();
}

public sealed class DiscoveryProviderStatus
{
    [JsonProperty("provider")] public string Provider { get; set; } = string.Empty;
    [JsonProperty("state")] public string State { get; set; } = string.Empty;
    [JsonProperty("reason")] public string? Reason { get; set; }
}

/// <summary>Calls unified discovery for the Search page's Games type.</summary>
public sealed class DiscoverySearch(IPlayarrApiClient api, HttpClient http)
{
    public Task<DiscoverySearchResponse> SearchGamesAsync(string query, int limit, CancellationToken ct = default) => SearchAsync(query, "games", limit, ct);

    /// <summary>Web <c>extraTitles</c>: the games and anything with a source beyond the library (peers, request catalogues).</summary>
    public static IReadOnlyList<DiscoveryTitle> ExtraTitles(IEnumerable<DiscoveryTitle> titles) =>
        titles.Where(title => title.Kind == "game" || title.Sources.Any(source => source.Source != "library")).ToList();

    /// <summary>Web <c>libraryDetailRoute</c> source: the library work a title links to, if any.</summary>
    public static Guid? LibraryWork(DiscoveryTitle title) => title.Sources.FirstOrDefault(source => source.Source == "library" && source.WorkId is not null)?.WorkId;

    /// <summary>Web <c>uniqueSourceKinds</c> + chip labels, joined as the caption's second part.</summary>
    public static string SourceChips(DiscoveryTitle title) => string.Join(" \u00b7 ", title.Sources.Select(source => source.Source).Distinct().Select(kind => kind switch
    {
        "library" => "Library", "peer" => "Peer server", "request" => "Requestable", "live_tv" => "Live TV", "game" => "Game", _ => kind,
    }));

    public async Task<DiscoverySearchResponse> SearchAsync(string query, string scope, int limit, CancellationToken ct = default)
    {
        var url = api.ResolveUrl($"/api/v1/discover?q={Uri.EscapeDataString(query)}&scope={scope}&limit={limit}")!;
        using var req = new HttpRequestMessage(HttpMethod.Get, url);
        foreach (var h in await api.GetPlaybackRequestHeadersAsync(ct).ConfigureAwait(false)) req.Headers.TryAddWithoutValidation(h.Key, h.Value);
        req.Headers.TryAddWithoutValidation("X-Playarr-Client-Platform", TizenClient.PlatformId);
        using var res = await http.SendAsync(req, ct).ConfigureAwait(false);
        var body = await res.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
        if (!res.IsSuccessStatusCode) throw new InvalidOperationException($"discovery failed: HTTP {(int)res.StatusCode}");
        return Parse(body);
    }

    public static DiscoverySearchResponse Parse(string json) =>
        JsonCoding.Deserialize<DiscoverySearchResponse>(json) ?? new DiscoverySearchResponse();
}
