using System.Net;
using System.Text;
using Playarr.Core.Auth;
using Playarr.Core.Models;
using Playarr.Core.Networking;
using Xunit;

namespace Playarr.Tizen.Logic.Tests;

public class IssuerAndUserSafetyTests
{
    private sealed class H(Func<HttpRequestMessage, HttpResponseMessage> f) : HttpMessageHandler
    {
        public List<string> Hits = new();
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage r, CancellationToken ct)
        { lock (Hits) Hits.Add(r.RequestUri!.Host + r.RequestUri.AbsolutePath); return Task.FromResult(f(r)); }
    }
    static string B64(string s) => Convert.ToBase64String(Encoding.UTF8.GetBytes(s)).TrimEnd('=').Replace('+','-').Replace('/','_');
    static readonly Guid Issuer = Guid.NewGuid(), Other = Guid.NewGuid(), Child = Guid.NewGuid(), Household = Guid.NewGuid();
    static string Jwt(Guid sub) => B64("{\"alg\":\"none\"}") + "." + B64($"{{\"iss\":\"{Issuer}\",\"sub\":\"{sub}\",\"device_id\":\"{Guid.NewGuid()}\"}}") + ".x";
    static HttpResponseMessage Json(HttpStatusCode c, string body) => new(c) { Content = new StringContent(body, Encoding.UTF8, "application/json") };
    static HttpResponseMessage Tokens(Guid sub) => Json(HttpStatusCode.OK, "{\"access_token\":\"" + Jwt(sub) + "\",\"refresh_token\":\"new\",\"token_type\":\"Bearer\",\"expires_in\":900,\"user_id\":\"" + sub + "\"}");
    static HttpResponseMessage U() => Json(HttpStatusCode.Unauthorized, "{\"error\":\"unauthorized\",\"message\":\"x\"}");
    static bool Is(HttpRequestMessage r, string s) => r.RequestUri!.AbsolutePath.EndsWith(s);

    static async Task<(PlayarrApiClient, InMemoryTokenStore, H)> Make(Func<HttpRequestMessage, HttpResponseMessage> f, TimeSpan exp, KnownServerGroup? g)
    {
        var store = new InMemoryTokenStore();
        await store.StoreSessionAsync(new() { AccessToken = new Sensitive<string>(Jwt(Child)), RefreshToken = new Sensitive<string>("old"), ExpiresAt = DateTimeOffset.UtcNow + exp });
        InMemoryKnownServerGroupStore? gs = null;
        if (g != null) { gs = new InMemoryKnownServerGroupStore(); await gs.RememberAsync(g); }
        var h = new H(f);
        return (new PlayarrApiClient(new ApiClientConfiguration(new Uri("https://wan.example"), Guid.NewGuid()), store, gs, new HttpClient(h)), store, h);
    }
    static KnownServerGroup Same() => new() { Servers = { new KnownServer { Url = "https://wan.example", PeerNodeId = Issuer }, new KnownServer { Url = "http://lan.example", PeerNodeId = Issuer } } };

    // F1 flipped: same-node 401 + unreachable now clears and falls back
    [Fact] public async Task F1_same_node_rejection_wins()
    {
        var (api, store, h) = await Make(r => r.RequestUri!.Host == "lan.example" ? throw new HttpRequestException("no route") : U(), TimeSpan.FromMinutes(-5), Same());
        await Record.ExceptionAsync(() => api.ListProfilesAsync());
        Assert.Null(await store.GetSessionAsync());
        Assert.Contains("wan.example/api/v1/auth/login", h.Hits);
    }

    // F1 residual: BaseUrl is ANOTHER node (401: token unknown there), issuer node briefly unreachable -> expected: keep session
    [Fact] public async Task F1b_other_node_401_while_issuer_unreachable_should_keep_session()
    {
        var g = new KnownServerGroup { Servers = { new KnownServer { Url = "https://wan.example", PeerNodeId = Other }, new KnownServer { Url = "http://lan.example", PeerNodeId = Issuer } } };
        var (api, store, h) = await Make(r => r.RequestUri!.Host == "lan.example" ? throw new HttpRequestException("no route") : U(), TimeSpan.FromMinutes(-5), g);
        await Record.ExceptionAsync(() => api.ListProfilesAsync());
        Console.WriteLine("F1b hits: " + string.Join(", ", h.Hits));
        Assert.NotNull(await store.GetSessionAsync());
    }

    // F2 flipped
    [Fact] public async Task F2_timeout_moves_on()
    {
        var (api, store, h) = await Make(r => Is(r, "/auth/refresh") && r.RequestUri!.Host == "wan.example" ? throw new TaskCanceledException("timeout")
            : Is(r, "/auth/refresh") ? Tokens(Child) : Json(HttpStatusCode.OK, "[]"), TimeSpan.FromMinutes(-5), Same());
        await api.ListProfilesAsync();
        Assert.Contains("lan.example/api/v1/auth/refresh", h.Hits);
        Assert.Equal("new", (await store.GetSessionAsync())!.RefreshToken.ExposeSecret());
    }

    // F3 flipped
    [Fact] public async Task F3_pin_required_keeps_session_no_login()
    {
        var (api, store, h) = await Make(_ => Json(HttpStatusCode.Forbidden, "{\"error\":\"pin_required\",\"message\":\"x\"}"), TimeSpan.FromMinutes(-5), Same());
        await Record.ExceptionAsync(() => api.ListProfilesAsync());
        Assert.NotNull(await store.GetSessionAsync());
        Assert.DoesNotContain(h.Hits, x => x.EndsWith("/auth/login"));
    }

    // F6 new: transient refresh failure + credential-less login success -> session for a different user replaces the child's
    [Fact] public async Task F6b_transient_refresh_should_not_switch_user()
    {
        var (api, store, _) = await Make(r => Is(r, "/auth/refresh") ? new HttpResponseMessage(HttpStatusCode.BadGateway)
            : Is(r, "/auth/login") ? Tokens(Household) : Json(HttpStatusCode.OK, "[]"), TimeSpan.FromMinutes(-5), null);
        // the expired token cannot be used and the login fallback is not tried, so the transient error surfaces
        var e = await Assert.ThrowsAsync<ApiException>(() => api.ListProfilesAsync());
        Assert.Equal(HttpStatusCode.BadGateway, e.StatusCode);
        var sub = JwtClaims.Subject((await store.GetSessionAsync())!.AccessToken.ExposeSecret());
        Console.WriteLine($"F6b stored sub: {(sub == Household ? "HOUSEHOLD" : sub == Child ? "child" : "?")}");
        Assert.Equal(Child, sub);
    }

    // F6 new: forceRefresh after a 401 returns the just-rejected token; caller sees Unauthorized, not the 502
    [Fact] public async Task F6c_force_refresh_transient_surfaces_the_transient_error()
    {
        var (api, store, h) = await Make(r => Is(r, "/auth/refresh") || Is(r, "/auth/login") ? new HttpResponseMessage(HttpStatusCode.BadGateway) : U(), TimeSpan.FromMinutes(10), null);
        var e = await Record.ExceptionAsync(() => api.ListProfilesAsync());
        Console.WriteLine($"F6c: {e?.GetType().Name} {(e as ApiException)?.StatusCode}; hits: " + string.Join(", ", h.Hits));
        Assert.Equal(HttpStatusCode.BadGateway, (e as ApiException)?.StatusCode);
    }
}
