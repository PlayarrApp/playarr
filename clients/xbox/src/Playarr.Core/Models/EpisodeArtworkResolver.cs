using System;
using System.Collections.Generic;
using System.Threading.Tasks;

namespace Playarr.Core.Models
{
    /// <summary>The ordered artwork sources available to a playable episode card.</summary>
    public enum EpisodeArtworkSource
    {
        EpisodeStill,
        MediaFrame,
        SeriesArtwork,
    }

    /// <summary>Matches the TV web's episode-card artwork preference.</summary>
    public static class EpisodeArtworkResolver
    {
        public static bool IntersectsCard(
            double viewportX,
            double viewportY,
            double viewportWidth,
            double viewportHeight,
            double cardWidth,
            double cardHeight)
        {
            if (viewportWidth <= 0 || viewportHeight <= 0 || cardWidth <= 0 || cardHeight <= 0)
            {
                return false;
            }

            var left = Math.Max(0, viewportX);
            var top = Math.Max(0, viewportY);
            var right = Math.Min(cardWidth, viewportX + viewportWidth);
            var bottom = Math.Min(cardHeight, viewportY + viewportHeight);
            return right > left && bottom > top;
        }

        public static IReadOnlyList<EpisodeArtworkSource> Resolve(
            bool hasEpisodeThumb,
            bool hasMediaFileId,
            bool hasSeriesArtwork)
        {
            var sources = new List<EpisodeArtworkSource>(3);
            if (hasEpisodeThumb)
            {
                sources.Add(EpisodeArtworkSource.EpisodeStill);
            }

            if (hasMediaFileId)
            {
                sources.Add(EpisodeArtworkSource.MediaFrame);
            }

            if (hasSeriesArtwork)
            {
                sources.Add(EpisodeArtworkSource.SeriesArtwork);
            }

            return sources;
        }

        public static async Task<bool> TryLoadFirstAsync(
            IReadOnlyList<EpisodeArtworkSource> sources,
            Func<EpisodeArtworkSource, Task<bool>> tryLoad)
        {
            foreach (var source in sources)
            {
                if (await tryLoad(source))
                {
                    return true;
                }
            }

            return false;
        }
    }
}
