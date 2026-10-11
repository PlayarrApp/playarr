using Playarr.Core.Models;
using Playarr.Core.Networking;

namespace Playarr.Tizen.Logic;

/// <summary>
/// GET /api/v1/catalog/search?q= . The server answers with a catalog page ({"items": [...]}); Playarr.Core's
/// SearchCatalogAsync still expects a bare array, so this reads the page itself.
/// </summary>
public sealed class CatalogSearch(IPlayarrApiClient api, HttpClient http)
{
    public async Task<IReadOnlyList<Work>> SearchAsync(string query, int limit, CancellationToken ct = default)
    {
        var url = api.ResolveUrl($"/api/v1/catalog/search?q={Uri.EscapeDataString(query)}&limit={limit}")!;
        using var req = new HttpRequestMessage(HttpMethod.Get, url);
        foreach (var h in await api.GetPlaybackRequestHeadersAsync(ct).ConfigureAwait(false)) req.Headers.TryAddWithoutValidation(h.Key, h.Value);
        req.Headers.TryAddWithoutValidation("X-Playarr-Client-Platform", TizenClient.PlatformId);
        using var res = await http.SendAsync(req, ct).ConfigureAwait(false);
        var body = await res.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
        if (!res.IsSuccessStatusCode) throw new InvalidOperationException($"search failed: HTTP {(int)res.StatusCode}");
        return Parse(body);
    }

    /// <summary>Accepts both shapes: a catalog page or a bare array.</summary>
    public static IReadOnlyList<Work> Parse(string json)
    {
        var trimmed = json.TrimStart();
        if (trimmed.StartsWith('[')) return (IReadOnlyList<Work>)(JsonCoding.Deserialize<List<Work>>(json) ?? new List<Work>());
        return JsonCoding.Deserialize<CatalogPage>(json)?.Items.ToList() ?? new List<Work>();
    }
}
