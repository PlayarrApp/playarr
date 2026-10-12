using Playarr.Core.Models;

namespace Playarr.Tizen.Logic;

/// <summary>
/// What to do when the player errors while an on-demand HLS session is playing: the server reaps or evicts an
/// idle session (a long pause, or a full node), after which the session cookie only gets 404s. The player asks for a
/// replacement session at the same position and keeps the viewer's play state.
/// </summary>
public static class PlaybackRecovery
{
    public const int MaxAttempts = 3;

    /// <summary>Only a started on-demand HLS session is recovered; direct play and downloads have no server session to lose.</summary>
    public static bool ShouldRecover(PlaybackMode mode, bool isLocalDownload, bool playbackStarted, int attemptsSoFar) =>
        mode == PlaybackMode.Hls && !isLocalDownload && playbackStarted && attemptsSoFar < MaxAttempts;

    /// <summary>A paused player stays paused after recovery; anything else plays on. An error carries no play state of its own.</summary>
    public static bool StartPlaying(bool wasPaused) => !wasPaused;

    /// <summary>Back-off before the next replacement request: 1.5 s, 3 s, 6 s.</summary>
    public static TimeSpan Delay(int attemptsSoFar) => TimeSpan.FromMilliseconds(1500 * (1 << Math.Min(attemptsSoFar, 2)));
}
