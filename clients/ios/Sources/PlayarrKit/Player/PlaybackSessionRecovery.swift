import Foundation

/// What to do when the player fails while an on-demand HLS session is playing. The server reaps or evicts an
/// idle session (a long pause, a full node); its playlist then answers 404, AVPlayer fails, and the player asks
/// for a replacement session at the same position, keeping the viewer's play state.
public enum PlaybackSessionRecovery {
    public static let maxAttempts = 3

    /// Only a started on-demand HLS session is recovered: direct play and downloaded files have no server session
    /// to lose, and a session that never played is the start-up path's business.
    public static func shouldRecover(mode: PlaybackMode?, isLocalFile: Bool, hasStarted: Bool, attemptsSoFar: Int) -> Bool {
        mode == .hls && !isLocalFile && hasStarted && attemptsSoFar < maxAttempts
    }

    /// A paused player stays paused. A failure carries no play state of its own, so this follows the last state
    /// the viewer actually had (playing, buffering or paused).
    public static func startsPlaying(lastState: PlayerPlaybackState) -> Bool {
        lastState != .paused
    }

    /// Back-off before the next replacement request: 1.5 s, 3 s, 6 s, then 6 s.
    public static func delay(attemptsSoFar: Int) -> Duration {
        .milliseconds(1_500 * (1 << min(max(attemptsSoFar, 0), 2)))
    }
}
