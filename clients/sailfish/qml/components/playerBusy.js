.pragma library

function shouldRun(error, hasInfo, loading, stalled, buffering, paused) {
    return !error && (!hasInfo || loading || (!paused && (stalled || buffering)))
}

function captureReady(playbackState, pausedState, pageActive, controls, engineMs, sourceMs, indicatorRunning, indicatorOpacity) {
    return playbackState === pausedState && pageActive && controls
            && engineMs === 2000 && sourceMs === 2000
            && !indicatorRunning && indicatorOpacity === 0
}
