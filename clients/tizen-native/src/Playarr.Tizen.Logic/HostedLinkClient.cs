using System.Net;
using System.Net.Http.Headers;
using System.Text;
using Newtonsoft.Json;

namespace Playarr.Tizen.Logic;

/// <summary>A code the hosted link broker issued; the TV shows it as a QR code plus the typed code.</summary>
public sealed record HostedLinkCode(string DeviceCode, string UserCode, string VerificationUri, string VerificationUriComplete, int IntervalSeconds, DateTimeOffset ExpiresAt);

/// <summary>What the phone side produced: the Playarr Server to talk to and its device code to redeem for tokens.</summary>
public sealed record HostedLinkClaim(string ServerUrl, string ServerDeviceCode, IReadOnlyList<string> ServerUrls);

public sealed class HostedLinkException(string message, bool expired = false) : Exception(message)
{
    public bool Expired { get; } = expired;
}

/// <summary>Port of web's lib/hostedDeviceLink.ts (request a code, poll until the phone approves it).</summary>
public sealed class HostedLinkClient(HttpClient http, string origin = HostedLinkClient.DefaultOrigin)
{
    public const string DefaultOrigin = "https://playarr.app";

    private sealed class CodeWire
    {
        [JsonProperty("device_code")] public string DeviceCode { get; set; } = "";
        [JsonProperty("user_code")] public string UserCode { get; set; } = "";
        [JsonProperty("verification_uri")] public string VerificationUri { get; set; } = "";
        [JsonProperty("verification_uri_complete")] public string VerificationUriComplete { get; set; } = "";
        [JsonProperty("expires_in")] public int ExpiresIn { get; set; }
        [JsonProperty("interval")] public int Interval { get; set; }
    }

    private sealed class ClaimWire
    {
        [JsonProperty("server_url")] public string? ServerUrl { get; set; }
        [JsonProperty("server_device_code")] public string? ServerDeviceCode { get; set; }
        [JsonProperty("server_urls")] public List<string>? ServerUrls { get; set; }
    }

    public async Task<HostedLinkCode> RequestCodeAsync(string clientPlatform, CancellationToken ct = default, DateTimeOffset? now = null)
    {
        using var req = new HttpRequestMessage(HttpMethod.Post, origin + "/api/link/code")
        {
            Content = new StringContent(JsonConvert.SerializeObject(new { client_platform = clientPlatform }), Encoding.UTF8, "application/json"),
        };
        req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        using var res = await http.SendAsync(req, ct).ConfigureAwait(false);
        if (!res.IsSuccessStatusCode) throw new HostedLinkException($"Playarr linking is unavailable (HTTP {(int)res.StatusCode}).");
        var wire = JsonConvert.DeserializeObject<CodeWire>(await res.Content.ReadAsStringAsync(ct).ConfigureAwait(false))
                   ?? throw new HostedLinkException("Playarr returned an unreadable link code.");
        return new HostedLinkCode(wire.DeviceCode, wire.UserCode, wire.VerificationUri, wire.VerificationUriComplete,
            Math.Max(1, wire.Interval), (now ?? DateTimeOffset.UtcNow).AddSeconds(wire.ExpiresIn));
    }

    /// <summary>Polls until the phone approves. 202 = pending, 404 = expired. One last poll is made just after expiry (redemption grace).</summary>
    public async Task<HostedLinkClaim> PollClaimAsync(HostedLinkCode code, Func<TimeSpan, CancellationToken, Task>? delay = null,
        Func<DateTimeOffset>? clock = null, CancellationToken ct = default)
    {
        var wait = delay ?? ((d, t) => Task.Delay(d, t));
        var now = clock ?? (() => DateTimeOffset.UtcNow);
        var graceUsed = false;
        while (now() < code.ExpiresAt || !graceUsed)
        {
            await wait(TimeSpan.FromSeconds(code.IntervalSeconds), ct).ConfigureAwait(false);
            if (now() >= code.ExpiresAt) graceUsed = true;
            using var req = new HttpRequestMessage(HttpMethod.Get, $"{origin}/api/link/code/{Uri.EscapeDataString(code.DeviceCode)}");
            req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
            using var res = await http.SendAsync(req, ct).ConfigureAwait(false);
            if (res.StatusCode == HttpStatusCode.Accepted) continue;
            if (res.StatusCode == HttpStatusCode.NotFound) throw new HostedLinkException("That Playarr link code expired. Try again.", expired: true);
            if (!res.IsSuccessStatusCode) throw new HostedLinkException($"Playarr linking is unavailable (HTTP {(int)res.StatusCode}).");
            var claim = JsonConvert.DeserializeObject<ClaimWire>(await res.Content.ReadAsStringAsync(ct).ConfigureAwait(false));
            if (claim?.ServerUrl is null || claim.ServerDeviceCode is null || claim.ServerUrls is null)
                throw new HostedLinkException("Playarr returned an invalid TV link response.");
            return new HostedLinkClaim(claim.ServerUrl, claim.ServerDeviceCode, claim.ServerUrls);
        }
        throw new HostedLinkException("That Playarr link code expired. Try again.", expired: true);
    }
}
