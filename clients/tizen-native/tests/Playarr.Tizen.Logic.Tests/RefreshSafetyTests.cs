using System.Net;
using System.Text;
using Playarr.Core.Auth;
using Playarr.Core.Models;
using Playarr.Core.Networking;
using Playarr.Tizen.Logic;
using Xunit;

namespace Playarr.Tizen.Logic.Tests;

/// <summary>Sign-in safety: a dead network never costs the session; a rejected refresh token does; the rotated pair is stored before use.</summary>
public class RefreshSafetyTests
{
    private sealed class Handler(Func<HttpRequestMessage, HttpResponseMessage> respond) : HttpMessageHandler
    {
        public readonly List<string> Hits = new();
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage r, CancellationToken ct)
        {
            lock (Hits) Hits.Add(r.RequestUri!.Host + r.RequestUri.AbsolutePath);
            return Task.FromResult(respond(r));
        }
        public int Count(string suffix) { lock (Hits) return Hits.Count(h => h.EndsWith(suffix)); }
    }

    private static string B64(string s) => Convert.ToBase64String(Encoding.UTF8.GetBytes(s)).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    private static readonly Guid Peer = Guid.NewGuid();
    private static string Jwt() => B64("{\"alg\":\"none\"}") + "." + B64($"{{\"iss\":\"{Peer}\",\"device_id\":\"{Guid.NewGuid()}\"}}") + ".x";
    private static HttpResponseMessage Json(HttpStatusCode c, string body) => new(c) { Content = new StringContent(body, Encoding.UTF8, "application/json") };
    private static HttpResponseMessage Tokens(string refresh = "new") => Json(HttpStatusCode.OK, "{\"access_token\":\"" + Jwt() + "\",\"refresh_token\":\"" + refresh + "\",\"token_type\":\"Bearer\",\"expires_in\":900,\"user_id\":\"" + Guid.NewGuid() + "\"}");
    private static bool IsRefresh(HttpRequestMessage r) => r.RequestUri!.AbsolutePath.EndsWith("/auth/refresh");
    private static bool IsLogin(HttpRequestMessage r) => r.RequestUri!.AbsolutePath.EndsWith("/auth/login");
    private static HttpResponseMessage Unauthorized() => Json(HttpStatusCode.Unauthorized, "{\"error\":\"unauthorized\",\"message\":\"refresh token is invalid or expired\"}");

    private static StoredAuthSession Session(TimeSpan expiresIn) => new() { AccessToken = new Sensitive<string>(Jwt()), RefreshToken = new Sensitive<string>("old"), ExpiresAt = DateTimeOffset.UtcNow + expiresIn };

    private static async Task<(PlayarrApiClient Api, InMemoryTokenStore Store, Handler H)> Make(Func<HttpRequestMessage, HttpResponseMessage> respond, TimeSpan? expiresIn = null, bool twoAddresses = false)
    {
        var store = new InMemoryTokenStore(); await store.StoreSessionAsync(Session(expiresIn ?? TimeSpan.FromMinutes(-5)));
        InMemoryKnownServerGroupStore? groups = null;
        if (twoAddresses)
        {
            groups = new InMemoryKnownServerGroupStore();
            await groups.RememberAsync(new KnownServerGroup { Servers = { new KnownServer { Url = "https://wan.example", PeerNodeId = Peer }, new KnownServer { Url = "http://lan.example", PeerNodeId = Peer } } });
        }
        var h = new Handler(respond);
        return (new PlayarrApiClient(new ApiClientConfiguration(new Uri("https://wan.example"), Guid.NewGuid()), store, groups, new HttpClient(h)), store, h);
    }

    private static HttpResponseMessage Ok(HttpRequestMessage r) => IsRefresh(r) || IsLogin(r) ? Tokens() : Json(HttpStatusCode.OK, "[]");

    [Fact]
    public async Task A_server_error_on_refresh_keeps_the_session()
    {
        var (api, store, h) = await Make(r => IsRefresh(r) ? new HttpResponseMessage(HttpStatusCode.BadGateway) : Unauthorized());
        var e = await Assert.ThrowsAsync<ApiException>(() => api.ListProfilesAsync());
        Assert.Equal(HttpStatusCode.BadGateway, e.StatusCode);
        Assert.NotNull(await store.GetSessionAsync());
        Assert.Equal(1, h.Count("/auth/refresh"));
    }

    [Fact]
    public async Task A_dropped_connection_on_refresh_keeps_the_session()
    {
        var (api, store, _) = await Make(r => IsRefresh(r) ? throw new HttpRequestException("connection reset") : Unauthorized());
        await Assert.ThrowsAsync<HttpRequestException>(() => api.ListProfilesAsync());
        Assert.NotNull(await store.GetSessionAsync());
    }

    [Fact]
    public async Task A_rejected_refresh_token_signs_out_once_without_looping()
    {
        var (api, store, h) = await Make(_ => Unauthorized());
        var e = await Assert.ThrowsAsync<ApiException>(() => api.ListProfilesAsync());
        Assert.Equal(ApiErrorKind.Unauthorized, e.Kind);
        Assert.Null(await store.GetSessionAsync());
        Assert.Equal(1, h.Count("/auth/refresh"));
    }

    [Fact]
    public async Task A_rejection_from_one_address_wins_over_an_unreachable_one()
    {
        var (api, store, h) = await Make(r => r.RequestUri!.Host == "lan.example" ? throw new HttpRequestException("no route") : Unauthorized(), twoAddresses: true);
        // the credential-less login fallback runs after the clear; its last error (the unreachable address) is what surfaces
        await Assert.ThrowsAsync<HttpRequestException>(() => api.ListProfilesAsync());
        Assert.Null(await store.GetSessionAsync());
        Assert.Contains("wan.example/api/v1/auth/refresh", h.Hits);
        Assert.Contains("wan.example/api/v1/auth/login", h.Hits);
    }

    [Fact]
    public async Task A_timeout_on_the_first_address_moves_on_to_the_next()
    {
        var (api, store, h) = await Make(r => IsRefresh(r) && r.RequestUri!.Host == "wan.example"
            ? throw new TaskCanceledException("The request was canceled due to the configured HttpClient.Timeout of 100 seconds elapsing.")
            : Ok(r), twoAddresses: true);
        await api.ListProfilesAsync();
        Assert.Contains("lan.example/api/v1/auth/refresh", h.Hits);
        Assert.Equal("new", (await store.GetSessionAsync())!.RefreshToken.ExposeSecret());
    }

    [Fact]
    public async Task A_caller_cancellation_stops_and_keeps_the_session()
    {
        var (api, store, h) = await Make(Ok, twoAddresses: true);
        using var cts = new CancellationTokenSource(); cts.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => api.ListProfilesAsync(cts.Token));
        Assert.NotNull(await store.GetSessionAsync());
        Assert.Empty(h.Hits);
    }

    [Fact]
    public async Task Pin_required_keeps_the_session_and_does_not_try_a_credential_less_login()
    {
        var (api, store, h) = await Make(_ => Json(HttpStatusCode.Forbidden, "{\"error\":\"pin_required\",\"message\":\"this profile is PIN-locked\"}"));
        var e = await Assert.ThrowsAsync<ApiException>(() => api.ListProfilesAsync());
        Assert.Equal(HttpStatusCode.Forbidden, e.StatusCode);
        Assert.Equal("pin_required", e.Body!.Error);
        Assert.NotNull(await store.GetSessionAsync());
        Assert.Equal(0, h.Count("/auth/login"));
    }

    [Fact]
    public async Task A_transient_refresh_failure_never_tries_the_credential_less_login()
    {
        // the login fallback could sign the device into the household user and bypass a child or PIN profile
        var (api, store, h) = await Make(r => IsRefresh(r) ? new HttpResponseMessage(HttpStatusCode.BadGateway) : Ok(r));
        var e = await Assert.ThrowsAsync<ApiException>(() => api.ListProfilesAsync());
        Assert.Equal(HttpStatusCode.BadGateway, e.StatusCode);
        Assert.Equal(0, h.Count("/auth/login"));
        Assert.Equal("old", (await store.GetSessionAsync())!.RefreshToken.ExposeSecret());
    }

    [Fact]
    public async Task A_still_valid_access_token_is_used_when_the_refresh_fails_transiently()
    {
        var (api, store, _) = await Make(r => IsRefresh(r) || IsLogin(r) ? new HttpResponseMessage(HttpStatusCode.BadGateway) : Json(HttpStatusCode.OK, "[]"), expiresIn: TimeSpan.FromMinutes(1));
        await api.ListProfilesAsync();
        Assert.Equal("old", (await store.GetSessionAsync())!.RefreshToken.ExposeSecret());
    }

    [Fact]
    public async Task Stored_session_is_flushed_and_round_trips()
    {
        var dir = Directory.CreateTempSubdirectory().FullName;
        var store = new FileSessionStore(dir);
        await store.StoreSessionAsync(Session(TimeSpan.FromMinutes(-5)));
        Assert.Equal("old", (await store.GetSessionAsync())!.RefreshToken.ExposeSecret());
        Assert.False(File.Exists(Path.Combine(dir, "session.json.tmp")));
    }
}
