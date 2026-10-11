using Playarr.Core.Models;
using Playarr.Core.Networking;

namespace Playarr.Tizen.Logic;

/// <summary>
/// GET /api/v1/playback/{file} with the Tizen device's direct-play capabilities (same conservative set as the web Tizen shell:
/// mp4/mp3/m4a, h264, aac/mp3); anything else comes back as an HLS session the player opens with the session cookie.
/// </summary>
public sealed class PlaybackClient(IPlayarrApiClient api, HttpClient http)
{
    public const string SessionCookieName = "playarr_playback_session";
    public static readonly IReadOnlyDictionary<string, string> Capabilities = new Dictionary<string, string>
    {
        ["containers"] = "mp4,mp3,m4a",
        ["video_codecs"] = "h264",
        ["audio_codecs"] = "aac,mp3",
    };

    public async Task<PlaybackInfoResponse> GetInfoAsync(Guid mediaFileId, long? startMs = null, CancellationToken ct = default)
    {
        var query = new List<string>();
        foreach (var kv in Capabilities) query.Add($"{kv.Key}={Uri.EscapeDataString(kv.Value)}");
        if (startMs is > 0) query.Add($"start_position_ms={startMs}");
        var url = api.ResolveUrl($"/api/v1/playback/{mediaFileId:D}?{string.Join("&", query)}")!;
        using var req = new HttpRequestMessage(HttpMethod.Get, url);
        foreach (var h in await api.GetPlaybackRequestHeadersAsync(ct).ConfigureAwait(false)) req.Headers.TryAddWithoutValidation(h.Key, h.Value);
        req.Headers.TryAddWithoutValidation("X-Playarr-Client-Platform", TizenClient.PlatformId);
        using var res = await http.SendAsync(req, ct).ConfigureAwait(false);
        var body = await res.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
        if (!res.IsSuccessStatusCode) throw new InvalidOperationException($"playback request failed: HTTP {(int)res.StatusCode}");
        return JsonCoding.Deserialize<PlaybackInfoResponse>(body) ?? throw new InvalidOperationException("unreadable playback response");
    }

    /// <summary>Cookie header value that authorises the HLS manifest and segments of a session.</summary>
    public static string SessionCookie(Guid sessionId) => $"{SessionCookieName}={Uri.EscapeDataString(sessionId.ToString())}";
}
