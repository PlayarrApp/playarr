package io.playarr.mobile.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PlayarrWebCssLayoutUnitTest {
    @Test
    fun cssLengthsTruncateToSixtyFourths() {
        assertEquals(6.390625f, webLayoutUnit(0.4f * 16f), 0f)
        assertEquals(13.1875f, webLayoutUnit(1.5f * 8.8f), 0f)
        assertEquals(11.515625f, webLayoutUnit(0.72f * 16f), 0f)
    }

    @Test
    fun clampResolvesBeforeLayoutUnit() {
        assertEquals(92.9375f, webClamp(92f, 11f * 845f / 100f, 124f), 0f)
        assertEquals(92f, webClamp(92f, 11f * 600f / 100f, 124f), 0f)
        assertEquals(124f, webClamp(92f, 11f * 1400f / 100f, 124f), 0f)
    }

    @Test
    fun frTracksShareFreeSpaceInLayoutUnits() {
        val columns = webFrTracks(720f, 7)
        assertEquals(7, columns.size)
        assertEquals(102.84375f, columns[0], 0f)
        assertEquals(719.90625f, webTrackEdges(0f, columns).last(), 0f)
    }

    @Test
    fun phoneMonthRowsFillTheBodyBelowTheHeaderAndBottomPadding() {
        // 845 css px viewport, month top 142 (toolbar bottom 130 plus the 0.75rem gap), five weeks.
        val month = webPhoneMonth(142f, 845f, 5)
        assertEquals(30.78125f, month.headerCss, 0f)
        assertEquals(6, month.rowEdgesCss.size)
        assertEquals(115.84375f, month.rowEdgesCss[1] - month.rowEdgesCss[0], 0f)
        val body = 845f - 92.9375f - (142f + 30.78125f)
        assertTrue(month.rowEdgesCss.last() <= body && body - month.rowEdgesCss.last() < 5 / 64f)
    }
}
