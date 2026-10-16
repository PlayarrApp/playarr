using Playarr.Core.Models;

namespace Playarr.Xbox.Views
{
    /// <summary>Fail-closed policy for opt-in Xbox player parity.</summary>
    public static class DirectPlayFixturePolicy
    {
        public static bool IsDirect(PlaybackMode mode) => mode == PlaybackMode.Direct;

        public static bool CanFallbackToLocal(bool requireDirectPlay, bool transportFailure) =>
            !requireDirectPlay && transportFailure;
    }
}
