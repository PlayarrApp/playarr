package io.playarr.mobile.webshell

import android.app.Activity
import android.os.Handler
import android.os.Looper
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.media3.common.C
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.Tracks
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.ui.PlayerView
import io.playarr.shared.player.ExoPlayerPlayarrPlayer
import io.playarr.shared.player.PlayarrPlayer
import io.playarr.shared.player.StreamFormat
import org.json.JSONArray
import org.json.JSONObject

/**
 * `window.PlayarrAndroidTvPlayer` for the web client's `AndroidTvNativeEngine`: Media3 plays on the surface behind the
 * page, the page keeps every control. State goes back to the page as JSON through `__playarrNativePlayerEvent`.
 */
internal class NativePlayerBridge(
    private val activity: Activity,
    private val web: WebView,
    private val plane: PlayerView,
) : Player.Listener {
    private val main = Handler(Looper.getMainLooper())
    private val http = DefaultHttpDataSource.Factory().setAllowCrossProtocolRedirects(true)
    private var player: PlayarrPlayer? = null
    private var started = false
    private var failure: PlaybackException? = null
    private val ticker = object : Runnable {
        override fun run() {
            push()
            if (player?.rawPlayer?.isPlaying == true) main.postDelayed(this, TICK_MS)
        }
    }

    private fun ensurePlayer(): PlayarrPlayer = player ?: ExoPlayerPlayarrPlayer.create(activity, dataSourceFactory = http).also {
        it.rawPlayer.addListener(this)
        plane.player = it.rawPlayer
        player = it
    }

    @JavascriptInterface
    fun load(url: String, mimeType: String, sessionId: String, startSeconds: Double) = main.post {
        started = false
        failure = null
        http.setDefaultRequestProperties(
            if (sessionId.isEmpty()) emptyMap() else mapOf("Cookie" to "playarr_playback_session=" + java.net.URLEncoder.encode(sessionId, "UTF-8")),
        )
        plane.visibility = View.VISIBLE
        val format = if (mimeType.contains("mpegurl", ignoreCase = true)) StreamFormat.Hls else StreamFormat.Direct
        ensurePlayer().prepare(url, format, (startSeconds * 1000).toLong())
        push()
    }

    @JavascriptInterface
    fun play() = main.post {
        started = true
        player?.play()
        push()
        main.removeCallbacks(ticker)
        main.postDelayed(ticker, TICK_MS)
    }

    @JavascriptInterface
    fun pause() = main.post { player?.pause(); push() }

    @JavascriptInterface
    fun seek(seconds: Double) = main.post { player?.seekTo((seconds * 1000).toLong()); push() }

    @JavascriptInterface
    fun setVolume(volume: Double) = main.post { player?.rawPlayer?.volume = volume.toFloat().coerceIn(0f, 1f) }

    @JavascriptInterface
    fun setMuted(muted: Boolean) = main.post { player?.rawPlayer?.volume = if (muted) 0f else 1f }

    @JavascriptInterface
    fun selectAudio(trackId: String) = main.post { select(C.TRACK_TYPE_AUDIO, trackId) }

    @JavascriptInterface
    fun selectSubtitle(trackId: String) = main.post { select(C.TRACK_TYPE_TEXT, trackId) }

    @JavascriptInterface
    fun release() {
        main.post {
            main.removeCallbacks(ticker)
            plane.player = null
            plane.visibility = View.GONE
            player?.release()
            player = null
        }
    }

    private fun select(type: Int, trackId: String) {
        val exo = player?.rawPlayer ?: return
        val builder = exo.trackSelectionParameters.buildUpon()
        if (trackId.isEmpty()) {
            builder.clearOverridesOfType(type).setTrackTypeDisabled(type, true)
        } else {
            val (g, t) = trackId.drop(1).split('_').map(String::toInt)
            val group = exo.currentTracks.groups.filter { it.type == type }.getOrNull(g) ?: return
            builder.setTrackTypeDisabled(type, false).setOverrideForType(TrackSelectionOverride(group.mediaTrackGroup, t))
        }
        exo.trackSelectionParameters = builder.build()
        push()
    }

    override fun onPlaybackStateChanged(playbackState: Int) = push()
    override fun onIsPlayingChanged(isPlaying: Boolean) = push()
    override fun onTracksChanged(tracks: Tracks) = push()
    override fun onPlayerError(error: PlaybackException) {
        failure = error
        push()
    }

    private fun trackJson(type: Int, prefix: String, exo: Player): Pair<JSONArray, String?> {
        val out = JSONArray()
        var selected: String? = null
        exo.currentTracks.groups.filter { it.type == type }.forEachIndexed { g, group ->
            for (t in 0 until group.length) {
                val f = group.getTrackFormat(t)
                val id = "$prefix${g}_$t"
                if (group.isTrackSelected(t)) selected = id
                out.put(
                    JSONObject()
                        .put("id", id)
                        .put("label", f.label ?: f.language ?: "Track ${g + 1}")
                        .put("language", f.language)
                        .put("codec", f.sampleMimeType?.substringAfter('/')?.uppercase())
                        .put("roles", JSONArray())
                        .put("channelsCount", f.channelCount.takeIf { it > 0 })
                        .put("forced", f.selectionFlags and C.SELECTION_FLAG_FORCED != 0)
                        .put("selected", group.isTrackSelected(t)),
                )
            }
        }
        return out to selected
    }

    private fun push() {
        val exo = player?.rawPlayer ?: return
        val failed = failure
        val state = when {
            failed != null -> "error"
            exo.playbackState == Player.STATE_ENDED -> "ended"
            exo.playbackState == Player.STATE_IDLE -> "loading"
            exo.playbackState == Player.STATE_BUFFERING -> if (started) "buffering" else "loading"
            exo.isPlaying -> "playing"
            started -> "paused"
            else -> "ready"
        }
        val audio = trackJson(C.TRACK_TYPE_AUDIO, "a", exo)
        val text = trackJson(C.TRACK_TYPE_TEXT, "t", exo)
        val json = JSONObject()
            .put("state", state)
            .put("positionSeconds", exo.currentPosition / 1000.0)
            .put("durationSeconds", if (exo.duration == C.TIME_UNSET) 0.0 else exo.duration / 1000.0)
            .put("bufferedSeconds", exo.bufferedPosition / 1000.0)
            .put("audioTracks", audio.first)
            .put("subtitleTracks", text.first)
            .put("selectedAudioTrackId", audio.second ?: JSONObject.NULL)
            .put("selectedSubtitleTrackId", if (exo.trackSelectionParameters.disabledTrackTypes.contains(C.TRACK_TYPE_TEXT)) JSONObject.NULL else text.second ?: JSONObject.NULL)
        if (failed != null) {
            json.put("error", JSONObject().put("code", failed.errorCodeName).put("message", failed.message ?: failed.errorCodeName))
        }
        web.evaluateJavascript("window.__playarrNativePlayerEvent&&window.__playarrNativePlayerEvent(${JSONObject.quote(json.toString())})", null)
    }

    private companion object {
        const val TICK_MS = 500L
    }
}
