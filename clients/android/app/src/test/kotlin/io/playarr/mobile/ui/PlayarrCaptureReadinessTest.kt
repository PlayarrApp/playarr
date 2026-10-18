package io.playarr.mobile.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PlayarrCaptureReadinessTest {
    @Test
    fun `surface state requires a current native screen and visible bounds`() {
        val state = PlayarrCaptureSurfaceState()
        state.begin("capture-a", "movies")
        assertEquals("filters", state.update("capture-a", "filters", visible = true))

        assertEquals("content", state.update("capture-a", "actions", visible = false))

        assertEquals("content", state.update("capture-a", "other", visible = true))
        assertNull(state.update("stale-generation", "actions", visible = true))
    }

    @Test
    fun `new generation resets surface state`() {
        val state = PlayarrCaptureSurfaceState()
        state.begin("capture-a", "movies")
        state.update("capture-a", "actions", visible = true)
        state.begin("capture-b", "movies")
        assertEquals("content", state.current("capture-b"))
        assertNull(state.current("capture-a"))
    }
}
