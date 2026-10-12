package io.playarr.mobile.ui

import io.playarr.shared.domain.model.PlayarrError
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PlayarrPlaybackRecoveryTest {
    private fun source(name: String) = File("src/main/kotlin/io/playarr/mobile/ui/$name").readText()

    @Test
    fun `recovery keeps a paused player paused and a playing one playing`() {
        assertFalse(playarrShouldPlayAfterRecovery(playWhenReadyBeforeError = false))
        assertTrue(playarrShouldPlayAfterRecovery(playWhenReadyBeforeError = true))
        // Neither recovery path hard-codes playing any more.
        val experience = source("PlayarrExperience.kt")
        assertFalse(experience.contains("shouldPlayOverride = true"))
        assertEquals(
            2,
            Regex("shouldPlayOverride = playarrShouldPlayAfterRecovery\\(").findAll(experience).count(),
        )
    }

    @Test
    fun `controls auto-hide after five seconds`() {
        assertEquals(5_000L, PLAYER_CONTROLS_TIMEOUT_MS)
    }

    @Test
    fun `automatic retries back off and then give up`() {
        assertEquals(1_500L, playarrAutoRetryDelayMs(0))
        assertEquals(3_000L, playarrAutoRetryDelayMs(1))
        assertEquals(6_000L, playarrAutoRetryDelayMs(2))
        assertNull(playarrAutoRetryDelayMs(3))
    }

    @Test
    fun `a full node is retried for longer than other errors`() {
        assertEquals(2_000L, playarrCapacityRetryDelayMs(0))
        assertEquals(8_000L, playarrCapacityRetryDelayMs(2))
        assertEquals(10_000L, playarrCapacityRetryDelayMs(9))
        assertNull(playarrCapacityRetryDelayMs(10))
        assertTrue(playarrCapacityRetryDelayMs(9)!! > PLAYER_AUTO_RETRY_DELAYS_MS.last())
    }

    @Test
    fun `only a 503 with Retry-After counts as a capacity refusal`() {
        fun http(code: Int, retryAfter: String?): PlayarrError {
            val builder = okhttp3.Response.Builder()
                .request(okhttp3.Request.Builder().url("http://localhost/").build())
                .protocol(okhttp3.Protocol.HTTP_1_1)
                .code(code)
                .message("x")
            if (retryAfter != null) builder.header("Retry-After", retryAfter)
            val body = okhttp3.ResponseBody.create(null, "{}")
            return PlayarrError.Http(code, retrofit2.HttpException(retrofit2.Response.error<Any>(body, builder.build())))
        }
        assertTrue(isTranscodeCapacityError(http(503, "5")))
        assertFalse(isTranscodeCapacityError(http(503, null)))
        assertFalse(isTranscodeCapacityError(http(500, "5")))
        assertFalse(isTranscodeCapacityError(PlayarrError.Unknown(RuntimeException())))
    }

    @Test
    fun `start, switch and session recovery all retry a capacity refusal`() {
        val experience = source("PlayarrExperience.kt")
        // One call in play() and one in switchNegotiatedPlayback(), which also serves seeks and the
        // recovery of a dropped on-demand session (404 playlist).
        assertEquals(2, Regex("scheduleCapacityRetry\\(mediaFileId, result\\.error\\)").findAll(experience).count())
        assertTrue(experience.contains("recoverExpiredHlsSession(currentError.message)"))
    }

    @Test
    fun `a retry after the decoder fallback stays on the converted stream`() {
        val original = PlayarrPlaybackLaunchSettings("original", null, false, 2, "sub-1")
        assertEquals(original, playarrAutoRetryLaunchSettings(original, decoderFallbackAttempted = false))
        assertNull(playarrAutoRetryLaunchSettings(null, decoderFallbackAttempted = false))

        val retry = playarrAutoRetryLaunchSettings(original, decoderFallbackAttempted = true)!!
        assertTrue(retry.forceTranscode)
        assertEquals(DECODE_FALLBACK_PROFILE, retry.profile)
        assertEquals(DECODE_FALLBACK_PROFILE, retry.qualityId)
        assertEquals(2, retry.audioStreamIndex)
        assertEquals("sub-1", retry.subtitleTrackId)
        assertTrue(playarrAutoRetryLaunchSettings(null, decoderFallbackAttempted = true)!!.forceTranscode)
        assertTrue(
            source("PlayarrExperience.kt")
                .contains("playarrAutoRetryLaunchSettings(activeRequest?.launchSettings, decoderFallbackAttempted)"),
        )
    }

    @Test
    fun `double tap seeks ten seconds by half of the screen`() {
        assertEquals(-10_000L, playarrDoubleTapSeekDeltaMs(100f, 1000f))
        assertEquals(10_000L, playarrDoubleTapSeekDeltaMs(900f, 1000f))
    }

    @Test
    fun `a stalled start is retried then surfaces a human error, never raw text`() {
        val experience = source("PlayarrExperience.kt")
        assertTrue(experience.contains("armStartStallWatchdog()"))
        assertTrue(experience.contains("scheduleAutoRetry("))
        assertTrue(experience.contains("PlayarrString.PlayerStartStalled"))
        assertFalse(experience.contains("""mapOf(
                                        "message" to currentError.message"""))
        assertTrue(PLAYER_START_STALL_TIMEOUT_MS in 10_000L..60_000L)
    }

    @Test
    fun `the converted stream fallback is announced and a failed player has the X close`() {
        val experience = source("PlayarrExperience.kt")
        assertTrue(experience.contains("_notice.value = PlayarrString.PlayerStreamConverted"))
        val failedBranch = experience.substringAfter("Errors show inside the player with the same X close").substringBefore("PlayarrEndOfPlaybackHost(")
        assertTrue(failedBranch.contains("PlayarrPlayerLoadingClose("))
        assertFalse(experience.contains("Icons.AutoMirrored.Outlined.ArrowBack,\n                    contentDescription = null,\n                    tint = Color.White)"))
    }

    @Test
    fun `leaving the app pauses and saves, and returning shows the controls`() {
        val experience = source("PlayarrExperience.kt")
        assertTrue(experience.contains("Lifecycle.Event.ON_STOP"))
        assertTrue(experience.contains("pauseForBackground()"))
        assertTrue(source("PlayarrPlayerChrome.kt").contains("Lifecycle.Event.ON_RESUME) { showControls() }"))
    }

    @Test
    fun `phone surface handles tap and double tap, television keeps clickable`() {
        val chrome = source("PlayarrPlayerChrome.kt")
        assertTrue(chrome.contains("detectTapGestures("))
        assertTrue(chrome.contains("onDoubleTap = { offset ->"))
    }
}
