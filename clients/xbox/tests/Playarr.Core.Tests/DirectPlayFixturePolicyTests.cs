using Playarr.Core.Models;
using Playarr.Xbox.Views;
using Xunit;

namespace Playarr.Core.Tests
{
    public sealed class DirectPlayFixturePolicyTests
    {
        [Fact]
        public void AllowsDirectNegotiation()
        {
            Assert.True(DirectPlayFixturePolicy.IsDirect(PlaybackMode.Direct));
        }

        [Theory]
        [InlineData(PlaybackMode.Hls)]
        [InlineData(PlaybackMode.Unknown)]
        public void RefusesNonDirectNegotiation(PlaybackMode mode)
        {
            Assert.False(DirectPlayFixturePolicy.IsDirect(mode));
        }

        [Fact]
        public void RequiredDirectPlayNeverFallsBackToLocalAfterTransportFailure()
        {
            Assert.False(DirectPlayFixturePolicy.CanFallbackToLocal(requireDirectPlay: true, transportFailure: true));
            Assert.True(DirectPlayFixturePolicy.CanFallbackToLocal(requireDirectPlay: false, transportFailure: true));
            Assert.False(DirectPlayFixturePolicy.CanFallbackToLocal(requireDirectPlay: false, transportFailure: false));
        }
    }
}
