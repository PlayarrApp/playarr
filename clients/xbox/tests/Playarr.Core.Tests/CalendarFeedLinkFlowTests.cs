using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Playarr.Core.Models;
using Playarr.Core.Networking;
using Xunit;

namespace Playarr.Core.Tests
{
    public class CalendarFeedLinkFlowTests
    {
        private sealed class FakeClient : ICalendarFeedClient
        {
            public CalendarFeedStatus Status { get; set; } = new CalendarFeedStatus();
            public List<bool> Rotations { get; } = new List<bool>();

            public Task<CalendarFeedStatus> GetCalendarFeedAsync(CancellationToken cancellationToken = default) =>
                Task.FromResult(Status);

            public Task<CalendarFeedCreated> CreateCalendarFeedAsync(bool rotate = false, CancellationToken cancellationToken = default)
            {
                Rotations.Add(rotate);
                return Task.FromResult(new CalendarFeedCreated
                {
                    Url = rotate ? "https://server.invalid/feed/new" : "https://server.invalid/feed/existing",
                    Token = "mock-token",
                });
            }
        }

        [Fact]
        public async Task OpeningAnInactiveFeedCreatesFirstLinkWithoutRotation()
        {
            var client = new FakeClient { Status = new CalendarFeedStatus { Active = false } };

            var result = await CalendarFeedLinkFlow.OpenAsync(client, null);

            Assert.Equal(CalendarFeedOpenKind.Link, result.Kind);
            Assert.Equal("https://server.invalid/feed/existing", result.Url);
            Assert.Equal(new[] { false }, client.Rotations);
        }

        [Fact]
        public async Task OpeningReShowableFeedRetrievesItsExistingLinkWithoutRotation()
        {
            var client = new FakeClient { Status = new CalendarFeedStatus { Active = true, LinkAvailable = true } };

            var result = await CalendarFeedLinkFlow.OpenAsync(client, null);

            Assert.Equal("https://server.invalid/feed/existing", result.Url);
            Assert.Equal(new[] { false }, client.Rotations);
        }

        [Theory]
        [InlineData(null)]
        [InlineData(false)]
        public async Task OlderServerDoesNotReplaceActiveFeedOnOpen(bool? linkAvailable)
        {
            var client = new FakeClient { Status = new CalendarFeedStatus { Active = true, LinkAvailable = linkAvailable } };

            var result = await CalendarFeedLinkFlow.OpenAsync(client, null);

            Assert.Equal(CalendarFeedOpenKind.NeedsReset, result.Kind);
            Assert.Empty(client.Rotations);
        }

        [Fact]
        public async Task OlderServerUsesStoredLinkAndDoesNotPost()
        {
            var client = new FakeClient { Status = new CalendarFeedStatus { Active = true } };

            var result = await CalendarFeedLinkFlow.OpenAsync(client, "https://server.invalid/feed/local-secret");

            Assert.Equal("https://server.invalid/feed/local-secret", result.Url);
            Assert.Empty(client.Rotations);
        }

        [Fact]
        public async Task OnlyExplicitResetRotates()
        {
            var client = new FakeClient { Status = new CalendarFeedStatus { Active = true, LinkAvailable = true } };

            var url = await CalendarFeedLinkFlow.ResetAsync(client);

            Assert.Equal("https://server.invalid/feed/new", url);
            Assert.Equal(new[] { true }, client.Rotations);
        }
    }
}
