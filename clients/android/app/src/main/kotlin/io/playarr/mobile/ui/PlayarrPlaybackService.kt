package io.playarr.mobile.ui

import android.content.Intent
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService

/**
 * The now-playing entry: Media3's service posts the media-style notification (title, artwork, position, Play/Pause, Seek,
 * Next and Previous) and routes the system's media buttons to the session. The session itself is built by
 * [PlayarrMediaSession] around the player the view model owns, so the service only adopts it.
 */
class PlayarrPlaybackService : MediaSessionService() {
    override fun onCreate() {
        super.onCreate()
        service = this
        adoptSession()
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = session

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        adoptSession()
        return super.onStartCommand(intent, flags, startId)
    }

    /** Playback ended with the task: nothing left to show. */
    override fun onTaskRemoved(rootIntent: Intent?) {
        session?.let { removeSession(it) }
        stopSelf()
    }

    override fun onDestroy() {
        if (service === this) service = null
        super.onDestroy()
    }

    private fun adoptSession() {
        session?.let { if (!sessions.contains(it)) addSession(it) }
    }

    internal companion object {
        @Volatile var session: MediaSession? = null
        @Volatile var service: PlayarrPlaybackService? = null
    }
}
