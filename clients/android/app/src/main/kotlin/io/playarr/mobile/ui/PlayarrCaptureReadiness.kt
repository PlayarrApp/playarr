package io.playarr.mobile.ui

import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalView
import io.playarr.shared.data.remote.PlayarrApiActivity

/** Debug parity capture barrier. No media identifiers are written to logcat. */
internal class PlayarrCaptureSurfaceState {
    private var generation: String? = null
    private var screen: String? = null
    private var value = "content"

    fun begin(token: String?, target: String?) {
        generation = token?.takeIf(String::isNotBlank)
        screen = target?.takeIf(String::isNotBlank)
        value = "content"
    }

    fun update(token: String?, next: String, visible: Boolean): String? {
        if (token == null || generation != token || screen !in setOf("movies", "series", "music")) return null
        if (next !in setOf("content", "filters", "actions")) return value
        value = if (visible) next else "content"
        return value
    }

    fun current(token: String?): String? = if (token == generation) value else null
}

internal object PlayarrCaptureReadiness {
    @Volatile private var generation: String? = null
    @Volatile private var screen: String? = null
    private val images = linkedMapOf<String, Boolean?>()
    private val visibleImages = mutableSetOf<String>()
    private var dataReady = false
    private var layoutReady = false
    private var dataCount = 0
    private val captureSurface = PlayarrCaptureSurfaceState()
    private val libraryScreens = setOf("movies", "series", "music")
    private val handler = Handler(Looper.getMainLooper())
    private var beganMs = 0L
    private var lastLayoutMs = 0L
    private var ticking = false

    // Screens other than the libraries carry no per-route data signal: their data is ready once the API has been quiet
    // for a while and the window has stopped laying out; artwork and focus stay gated as for the libraries.
    private const val QUIET_API_MS = 1_500L
    private const val QUIET_LAYOUT_MS = 700L
    private const val SETTLE_MS = 2_500L
    private const val TICK_MS = 400L

    @Synchronized fun begin(value: String?, target: String?) {
        generation = value?.takeIf(String::isNotBlank)
        screen = target?.takeIf(String::isNotBlank)
        dataReady = false
        layoutReady = false
        dataCount = 0
        captureSurface.begin(value, target)
        images.clear()
        visibleImages.clear()
        beganMs = nowMs()
        lastLayoutMs = beganMs
        generation?.let { Log.i("PlayarrParity", "capture_generation=$it") }
        if (generation != null && !ticking) {
            ticking = true
            handler.postDelayed(::tick, TICK_MS)
        }
    }

    private fun nowMs() = System.nanoTime() / 1_000_000

    /** The window laid out again (debug capture only): the layout is not settled until this stops. */
    @Synchronized fun layoutPass() {
        if (generation != null) lastLayoutMs = nowMs()
    }

    @Synchronized private fun tick() {
        if (generation == null || screen == null) { ticking = false; return }
        val now = nowMs()
        if (screen !in libraryScreens) {
            dataReady = now - beganMs >= SETTLE_MS && PlayarrApiActivity.isQuiet(QUIET_API_MS)
            dataCount = 0
        }
        // The layout is settled once the data is ready and the window has stopped laying out for a while.
        layoutReady = dataReady && now - lastLayoutMs >= QUIET_LAYOUT_MS
        report()
        handler.postDelayed(::tick, TICK_MS)
    }

    @Synchronized fun generationToken(): String? = generation

    @Synchronized fun dataReady(token: String?, value: String, count: Int) {
        if (token == null || generation != token) return
        if (screen != value) return
        lastLayoutMs = nowMs()
        layoutReady = false
        dataReady = true
        dataCount = count
        report()
    }

    @Synchronized fun dataLoading(token: String?, value: String) {
        if (token == null || generation != token || screen != value) return
        dataReady = false
        layoutReady = false
        report()
    }

    @Synchronized fun surface(token: String?, value: String, visible: Boolean = true) {
        if (captureSurface.update(token, value, visible) == null) return
        report()
    }


    @Synchronized fun layoutReady(token: String?, value: String) {
        if (token == null || generation != token || screen != value) return
        lastLayoutMs = nowMs()
    }

    @Synchronized fun imageVisible(token: String?, key: String) {
        if (token == null || generation != token) return
        visibleImages.add(key)
        images.putIfAbsent(key, null)
        report()
    }

    @Synchronized fun imageFinished(token: String?, key: String, failed: Boolean = false) {
        if (token == null || generation != token) return
        images[key] = failed
        if (key in visibleImages) report()
    }

    @Synchronized fun imageGone(token: String?, key: String) {
        if (token == null || generation != token) return
        if (visibleImages.remove(key)) report()
    }

    @Synchronized private fun report() {
        val id = generation ?: return
        val route = screen ?: return
        val pending = visibleImages.count { images[it] == null }
        val failed = visibleImages.count { images[it] == true }
        Log.i("PlayarrParity", "capture_state generation=$id screen=$route data=${if (dataReady) "ready" else "loading"} data_count=$dataCount layout=${if (layoutReady) "ready" else "loading"} surface=${captureSurface.current(id)} art_seen=${visibleImages.size} art_pending=$pending art_failed=$failed")
    }
}

/** Tracks only images whose laid-out bounds intersect the app viewport. */
@Composable
internal fun Modifier.parityCaptureArtwork(token: String?, key: String): Modifier {
    if (token == null) return this
    val view = LocalView.current
    DisposableEffect(key) {
        onDispose { PlayarrCaptureReadiness.imageGone(token, key) }
    }
    return onGloballyPositioned { coordinates ->
        val bounds = coordinates.boundsInRoot()
        val visible = bounds.width > 0f && bounds.height > 0f &&
            bounds.left < view.width && bounds.top < view.height && bounds.right > 0f && bounds.bottom > 0f
        if (visible) PlayarrCaptureReadiness.imageVisible(token, key)
        else PlayarrCaptureReadiness.imageGone(token, key)
    }
}

@Composable
internal fun Modifier.parityCaptureLayout(token: String?, target: String?): Modifier {
    val view = LocalView.current
    if (token == null || target == null) return this
    return onGloballyPositioned {
        view.postOnAnimation { PlayarrCaptureReadiness.layoutReady(token, target) }
    }
}

@Composable
internal fun Modifier.parityCaptureSurface(token: String?, surface: String?): Modifier {
    if (token == null || surface == null) return this
    DisposableEffect(token, surface) {
        onDispose { PlayarrCaptureReadiness.surface(token, "content") }
    }
    return onGloballyPositioned { coordinates ->
        val bounds = coordinates.boundsInRoot()
        PlayarrCaptureReadiness.surface(token, surface, bounds.width > 0f && bounds.height > 0f)
    }
}

@Composable
internal fun parityCaptureGenerationToken(): String? = remember { PlayarrCaptureReadiness.generationToken() }
