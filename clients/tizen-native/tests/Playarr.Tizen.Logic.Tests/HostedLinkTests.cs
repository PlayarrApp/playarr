using System.Net;
using System.Text;
using Playarr.Tizen.Logic;
using Xunit;

public class HostedLinkTests
{
    private sealed class Script(params (HttpStatusCode, string)[] replies) : HttpMessageHandler
    {
        private int _i;
        public List<string> Requests { get; } = new();
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Requests.Add(request.Method + " " + request.RequestUri!.PathAndQuery);
            var (status, body) = replies[Math.Min(_i++, replies.Length - 1)];
            return Task.FromResult(new HttpResponseMessage(status) { Content = new StringContent(body, Encoding.UTF8, "application/json") });
        }
    }

    private const string CodeJson = """{"device_code":"dc","user_code":"ABCD-1234","verification_uri":"https://x.example/link","verification_uri_complete":"https://x.example/link?c=ABCD-1234","expires_in":300,"interval":2}""";
    private const string ClaimJson = """{"server_url":"https://s.example","server_device_code":"sdc","server_urls":["https://s.example"]}""";

    [Fact]
    public async Task RequestsACodeAndStampsExpiry()
    {
        var h = new Script((HttpStatusCode.OK, CodeJson));
        var now = new DateTimeOffset(2026, 10, 11, 0, 0, 0, TimeSpan.Zero);
        var code = await new HostedLinkClient(new HttpClient(h), "https://x.example").RequestCodeAsync("web", now: now);
        Assert.Equal("ABCD-1234", code.UserCode);
        Assert.Equal(now.AddSeconds(300), code.ExpiresAt);
        Assert.Equal("POST /api/link/code", h.Requests[0]);
    }

    [Fact]
    public async Task PollsThroughPendingThenReturnsTheClaim()
    {
        var h = new Script((HttpStatusCode.Accepted, ""), (HttpStatusCode.Accepted, ""), (HttpStatusCode.OK, ClaimJson));
        var client = new HostedLinkClient(new HttpClient(h), "https://x.example");
        var code = new HostedLinkCode("dc", "u", "v", "vc", 2, DateTimeOffset.UtcNow.AddMinutes(5));
        var claim = await client.PollClaimAsync(code, delay: (_, _) => Task.CompletedTask);
        Assert.Equal("sdc", claim.ServerDeviceCode);
        Assert.Equal(3, h.Requests.Count);
    }

    [Fact]
    public async Task NotFoundMeansExpiredAndIsFlagged()
    {
        var client = new HostedLinkClient(new HttpClient(new Script((HttpStatusCode.NotFound, ""))), "https://x.example");
        var code = new HostedLinkCode("dc", "u", "v", "vc", 1, DateTimeOffset.UtcNow.AddMinutes(5));
        var e = await Assert.ThrowsAsync<HostedLinkException>(() => client.PollClaimAsync(code, delay: (_, _) => Task.CompletedTask));
        Assert.True(e.Expired);
    }

    [Fact]
    public async Task OneLastPollAfterExpiryThenGivesUp()
    {
        var h = new Script((HttpStatusCode.Accepted, ""));
        var client = new HostedLinkClient(new HttpClient(h), "https://x.example");
        var t = DateTimeOffset.UtcNow;
        var code = new HostedLinkCode("dc", "u", "v", "vc", 1, t.AddSeconds(-1)); // already expired
        await Assert.ThrowsAsync<HostedLinkException>(() => client.PollClaimAsync(code, delay: (_, _) => Task.CompletedTask, clock: () => t));
        Assert.Single(h.Requests);
    }

    [Fact]
    public void QrEncodesToPng() => Assert.Equal(0x89, QrImage.Png("https://x.example/link?c=ABCD-1234", 4)[0]);
}
