' Resume and progress reporting for the native player. Uses the same server
' API as the web player: GET /api/v1/playback/{id}/progress before play and
' PUT /api/v1/playback/{id}/progress while playing and on every exit path.
' These calls run in their own ApiTask nodes, never in the single-flight
' MainScene queue, so an exit flush cannot be queued behind or replaced by
' another request.

' Resume position in whole seconds from a WatchProgress body, or invalid.
function ProgressResumeSeconds(data as Dynamic) as Dynamic
    if data = invalid or Type(data) <> "roAssociativeArray" then return invalid
    if data.state <> "part_watched" then return invalid
    if data.position_ms = invalid then return invalid
    if data.position_ms <= 0 then return invalid
    return data.position_ms / 1000
end function

' Never write position 0 or overwrite a resume point when playback never
' started. A completed write is allowed once playback has started.
function ProgressShouldWrite(started as Boolean, positionMs as Integer, completed as Boolean) as Boolean
    if not started then return false
    if positionMs <= 0 and not completed then return false
    return true
end function

sub startResumeFetch(mediaFileId as String, playbackPath as String)
    m.resumeSeconds = invalid
    m.playbackPath = playbackPath
    task = CreateObject("roSGNode", "ApiTask")
    task.ObserveField("result", "onResumeResult")
    task.request = {
        method: "GET"
        url: m.serverUrl + "/api/v1/playback/" + UrlEncode(mediaFileId) + "/progress"
        accessToken: m.accessToken
        mediaFileId: mediaFileId
    }
    m.resumeTask = task
    task.control = "RUN"
end sub

' Resume lookup finished (or failed): request the session, starting an
' on-demand transcode at the resume point exactly as the web player does.
sub onResumeResult(event as Object)
    result = event.GetData()
    if result = invalid or m.resumeTask = invalid then return
    if m.resumeTask.request.mediaFileId <> m.currentMediaFileId then return
    m.resumeSeconds = invalid
    if result.ok then m.resumeSeconds = ProgressResumeSeconds(result.data)
    ' A recovered session resumes where this player stopped, not at the last saved position.
    if m.recoverPositionSeconds <> invalid
        m.resumeSeconds = m.recoverPositionSeconds
        m.recoverPositionSeconds = invalid
    end if
    m.resumeTask = invalid
    if m.playbackEnded then return
    path = m.playbackPath
    if m.resumeSeconds <> invalid
        path += "&start_position_ms=" + Int(m.resumeSeconds * 1000).ToStr()
    end if
    sendApi("playback", "GET", path, invalid, true)
end sub

' Seeks to the resume point inside the session that startPlayback opened.
' The server reports source_offset_ms when it transcoded from the resume
' point, in which case the player position is relative to that offset.
sub ProgressApplyResume(data as Object)
    m.playbackMode = data.mode
    ' A session replaced by recovery keeps the viewer's play state: a player that was paused stays paused.
    if m.recoveringSession = true
        m.recoveringSession = false
        if m.recoverPaused = true then m.video.control = "pause"
        m.recoverPaused = false
    else
        m.sessionRecoveries = 0
    end if
    m.sourceOffsetSeconds = 0
    if data.source_offset_ms <> invalid then m.sourceOffsetSeconds = data.source_offset_ms / 1000
    m.playbackDurationMs = 0
    if data.duration_ms <> invalid then m.playbackDurationMs = data.duration_ms
    seekTo = invalid
    if m.resumeSeconds <> invalid then seekTo = m.resumeSeconds - m.sourceOffsetSeconds
    m.resumeSeconds = invalid
    m.startRetriesLeft = 0
    ' An on-demand transcode answers 404 until its first playlist exists (about 20 s for a long film), whether or not it starts at a
    ' resume point: keep retrying every 3 s for 45 s, as the web player does.
    if m.sourceOffsetSeconds > 0 or data.mode = "hls" then m.startRetriesLeft = 15
    if seekTo <> invalid and seekTo >= 1 then m.video.seek = seekTo
end sub

' Writes the current position. Fire and forget in a dedicated task.
sub persistPlaybackProgress(completed as Boolean)
    if m.currentMediaFileId = invalid or m.currentMediaFileId = "" then return
    positionMs = Int((m.video.position + m.sourceOffsetSeconds) * 1000)
    durationMs = Int(m.video.duration * 1000)
    if m.playbackDurationMs > durationMs then durationMs = m.playbackDurationMs
    if not ProgressShouldWrite(m.playbackStarted = true, positionMs, completed) then return
    if durationMs < positionMs then durationMs = positionMs
    if m.progressTasks = invalid then m.progressTasks = []
    task = CreateObject("roSGNode", "ApiTask")
    task.request = {
        method: "PUT"
        url: m.serverUrl + "/api/v1/playback/" + UrlEncode(m.currentMediaFileId) + "/progress"
        accessToken: m.accessToken
        body: { position_ms: positionMs, duration_ms: durationMs, completed: completed }
    }
    ' Keep a reference so the task is not collected before it finishes.
    m.progressTasks.Push(task)
    if m.progressTasks.Count() > 4 then m.progressTasks.Shift()
    task.control = "RUN"
end sub

' How many replacement sessions a player may ask for after the server reaped or evicted its idle on-demand session.
function ProgressMaxSessionRecoveries() as Integer
    return 3
end function

' Whether an error mid-playback is a lost on-demand session worth replacing: only a started HLS session of a
' known title, within the retry limit. Direct play has no server session to lose.
function ProgressCanRecoverSession(started as Boolean, ended as Boolean, mode as Dynamic, recoveries as Dynamic) as Boolean
    if not started or ended then return false
    if mode <> "hls" then return false
    if recoveries = invalid then recoveries = 0
    return recoveries < ProgressMaxSessionRecoveries()
end function

' A paused player stays paused after recovery; anything else plays on. An error carries no play state itself.
function ProgressStartsPlayingAfterRecovery(lastState as Dynamic) as Boolean
    return lastState <> "paused"
end function

' The player errored after playing: ask for a replacement session at the same position and keep the paused state.
function ProgressRecoverSession() as Boolean
    if m.currentMediaFileId = invalid or m.currentMediaFileId = "" then return false
    if not ProgressCanRecoverSession(m.playbackStarted = true, m.playbackEnded = true, m.playbackMode, m.sessionRecoveries) then return false
    if m.sessionRecoveries = invalid then m.sessionRecoveries = 0
    m.sessionRecoveries = m.sessionRecoveries + 1
    position = m.video.position
    if position <= 0 and m.lastKnownSeconds <> invalid then position = m.lastKnownSeconds
    m.recoverPositionSeconds = position + m.sourceOffsetSeconds
    m.recoverPaused = not ProgressStartsPlayingAfterRecovery(m.lastVideoState)
    m.recoveringSession = true
    requestPlayback(m.currentMediaFileId)
    return true
end function

' Re-opens the stream after a start error while nothing has played yet.
function ProgressRetryStart() as Boolean
    if m.playbackStarted = true or m.playbackEnded then return false
    if m.startRetriesLeft = invalid or m.startRetriesLeft <= 0 then return false
    m.startRetriesLeft = m.startRetriesLeft - 1
    if m.startRetryTimer = invalid
        m.startRetryTimer = CreateObject("roSGNode", "Timer")
        m.startRetryTimer.duration = 3
        m.startRetryTimer.repeat = false
        m.startRetryTimer.ObserveField("fire", "onStartRetry")
    end if
    m.startRetryTimer.control = "stop"
    m.startRetryTimer.control = "start"
    return true
end function

sub onStartRetry()
    if m.playbackEnded or m.playbackStarted = true then return
    content = m.video.content
    if content = invalid then return
    m.video.control = "stop"
    m.video.content = content.Clone(true)
    m.video.control = "play"
end sub
