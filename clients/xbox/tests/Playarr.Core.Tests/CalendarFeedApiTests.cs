using System;
using System.Collections.Generic;
using System.Net;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using Playarr.Core.Networking;
using Xunit;

namespace Playarr.Core.Tests
{
    public class CalendarFeedApiTests
    {
        private sealed class MockHandler : HttpMessageHandler
        {
            private readonly Queue<string> _bodies;

            public MockHandler(params string[] bodies) => _bodies = new Queue<string>(bodies);

            public List<string> Requests { get; } = new List<string>();

            protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
            {
                Requests.Add(request.Method.Method + " " + request.RequestUri!.PathAndQuery);
                return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = new StringContent(_bodies.Dequeue()),
                });
            }
        }

        [Fact]
        public async Task CalendarFeedUsesStatusPostAndExplicitRotateRoutes()
        {
            var handler = new MockHandler(
                "{\"active\":true,\"link_available\":false}",
                "{\"url\":\"https://server.invalid/feed/mock-only\",\"token\":\"not-a-live-token\",\"created_at\":\"2026-10-13T00:00:00Z\"}",
                "{\"url\":\"https://server.invalid/feed/mock-reset\",\"token\":\"not-a-live-token\",\"created_at\":\"2026-10-13T00:00:00Z\"}");
            var client = new PlayarrApiClient(
                new ApiClientConfiguration(new Uri("https://server.invalid/prefix/"), Guid.Empty),
                httpClient: new HttpClient(handler));

            var status = await client.GetCalendarFeedAsync();
            Assert.True(status.Active);
            Assert.False(status.LinkAvailable);
            await client.CreateCalendarFeedAsync(rotate: false);
            await client.CreateCalendarFeedAsync(rotate: true);

            Assert.Equal(new[]
            {
                "GET /prefix/api/v1/calendar/feed",
                "POST /prefix/api/v1/calendar/feed",
                "POST /prefix/api/v1/calendar/feed?rotate=true",
            }, handler.Requests);
        }
    }
}
