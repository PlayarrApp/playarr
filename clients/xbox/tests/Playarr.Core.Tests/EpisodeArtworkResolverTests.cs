using System.Collections.Generic;
using System.Threading.Tasks;
using Playarr.Core.Models;
using Xunit;

namespace Playarr.Core.Tests
{
    public class EpisodeArtworkResolverTests
    {
        [Fact]
        public void RejectsPositiveViewportOutsideCardBounds()
        {
            Assert.False(EpisodeArtworkResolver.IntersectsCard(110, 10, 20, 20, 100, 100));
        }

        [Fact]
        public void AcceptsPartiallyIntersectingViewport()
        {
            Assert.True(EpisodeArtworkResolver.IntersectsCard(90, 10, 20, 20, 100, 100));
        }

        [Fact]
        public void RejectsZeroViewportWidthOrHeight()
        {
            Assert.False(EpisodeArtworkResolver.IntersectsCard(10, 10, 0, 20, 100, 100));
            Assert.False(EpisodeArtworkResolver.IntersectsCard(10, 10, 20, 0, 100, 100));
        }

        [Fact]
        public void RejectsZeroCardWidthOrHeight()
        {
            Assert.False(EpisodeArtworkResolver.IntersectsCard(0, 0, 20, 20, 0, 100));
            Assert.False(EpisodeArtworkResolver.IntersectsCard(0, 0, 20, 20, 100, 0));
        }

        [Fact]
        public void PrefersEpisodeStillThenMediaFrameThenSeriesArtwork()
        {
            Assert.Equal(
                new[]
                {
                    EpisodeArtworkSource.EpisodeStill,
                    EpisodeArtworkSource.MediaFrame,
                    EpisodeArtworkSource.SeriesArtwork,
                },
                EpisodeArtworkResolver.Resolve(hasEpisodeThumb: true, hasMediaFileId: true, hasSeriesArtwork: true));
        }

        [Fact]
        public void MissingEpisodeThumbStartsWithMediaFrame()
        {
            Assert.Equal(
                new[] { EpisodeArtworkSource.MediaFrame, EpisodeArtworkSource.SeriesArtwork },
                EpisodeArtworkResolver.Resolve(hasEpisodeThumb: false, hasMediaFileId: true, hasSeriesArtwork: true));
        }

        [Fact]
        public void MissingMediaFileIdSkipsFrameAndFallsBackFromStillToSeriesArtwork()
        {
            Assert.Equal(
                new[] { EpisodeArtworkSource.EpisodeStill, EpisodeArtworkSource.SeriesArtwork },
                EpisodeArtworkResolver.Resolve(hasEpisodeThumb: true, hasMediaFileId: false, hasSeriesArtwork: true));
        }

        [Fact]
        public void MissingStillAndMediaFileUsesSeriesArtworkOnly()
        {
            Assert.Equal(
                new[] { EpisodeArtworkSource.SeriesArtwork },
                EpisodeArtworkResolver.Resolve(hasEpisodeThumb: false, hasMediaFileId: false, hasSeriesArtwork: true));
        }

        [Fact]
        public async Task FailedStillFallsBackToFrameAndStopsBeforeSeriesArtwork()
        {
            var attempted = new List<EpisodeArtworkSource>();
            var loaded = await EpisodeArtworkResolver.TryLoadFirstAsync(
                EpisodeArtworkResolver.Resolve(hasEpisodeThumb: true, hasMediaFileId: true, hasSeriesArtwork: true),
                async source =>
                {
                    attempted.Add(source);
                    await Task.Yield();
                    return source == EpisodeArtworkSource.MediaFrame;
                });

            Assert.True(loaded);
            Assert.Equal(
                new[] { EpisodeArtworkSource.EpisodeStill, EpisodeArtworkSource.MediaFrame },
                attempted);
        }

        [Fact]
        public async Task ReturnsFalseWhenEveryArtworkSourceFails()
        {
            var attempted = new List<EpisodeArtworkSource>();
            var loaded = await EpisodeArtworkResolver.TryLoadFirstAsync(
                EpisodeArtworkResolver.Resolve(hasEpisodeThumb: true, hasMediaFileId: true, hasSeriesArtwork: true),
                source =>
                {
                    attempted.Add(source);
                    return Task.FromResult(false);
                });

            Assert.False(loaded);
            Assert.Equal(
                new[]
                {
                    EpisodeArtworkSource.EpisodeStill,
                    EpisodeArtworkSource.MediaFrame,
                    EpisodeArtworkSource.SeriesArtwork,
                },
                attempted);
        }
    }
}
