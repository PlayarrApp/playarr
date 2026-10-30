package io.playarr.mobile.ui

import io.playarr.mobile.ui.PlayarrEllipsizedRun.Side
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PlayarrEllipsizedRunTest {
    private val ellipsis = "…"

    @Test
    fun endTruncationKeepsTheStartAndAppendsTheEllipsis() {
        val span = PlayarrEllipsizedRun.span(lineStart = 0, ellipsisStart = 6, ellipsisCount = 5, paragraphStart = 0)
        assertEquals("abcdef$ellipsis", PlayarrEllipsizedRun.displayedText("abcdefghijk", 0, 11, span, ellipsis))
        assertEquals(Side.After, PlayarrEllipsizedRun.side(0, 11, span))
    }

    @Test
    fun startTruncationKeepsTheTailAfterTheEllipsis() {
        val span = PlayarrEllipsizedRun.span(lineStart = 0, ellipsisStart = 0, ellipsisCount = 5, paragraphStart = 0)
        assertEquals("${ellipsis}fghijk", PlayarrEllipsizedRun.displayedText("abcdefghijk", 0, 11, span, ellipsis))
        assertEquals(Side.Before, PlayarrEllipsizedRun.side(0, 11, span))
        assertEquals((5 until 11).toList(), PlayarrEllipsizedRun.visibleIndices(0, 11, span))
    }

    @Test
    fun middleTruncationKeepsBothEnds() {
        val span = PlayarrEllipsizedRun.span(lineStart = 0, ellipsisStart = 3, ellipsisCount = 4, paragraphStart = 0)
        assertEquals("abc${ellipsis}hijk", PlayarrEllipsizedRun.displayedText("abcdefghijk", 0, 11, span, ellipsis))
        assertEquals(Side.Between, PlayarrEllipsizedRun.side(0, 11, span))
    }

    @Test
    fun anEllipsisOnlyLineDisplaysJustTheEllipsis() {
        // A run wholly replaced still displays the ellipsis (the line is not empty), even when the replaced characters are blanks.
        val span = PlayarrEllipsizedRun.span(lineStart = 0, ellipsisStart = 0, ellipsisCount = 3, paragraphStart = 0)
        assertEquals(ellipsis, PlayarrEllipsizedRun.displayedText("   ", 0, 3, span, ellipsis))
        assertEquals(ellipsis, PlayarrEllipsizedRun.displayedText("abc", 0, 3, span, ellipsis))
        assertTrue(PlayarrEllipsizedRun.visibleIndices(0, 3, span).isEmpty())
        assertEquals(Side.Only, PlayarrEllipsizedRun.side(0, 3, span))
        assertTrue(PlayarrEllipsizedRun.holdsEllipsis(0, 3, span))
    }

    @Test
    fun onlyTheRunHoldingTheFirstReplacedCharacterCarriesTheEllipsis() {
        val span = PlayarrEllipsizedRun.span(lineStart = 4, ellipsisStart = 2, ellipsisCount = 6, paragraphStart = 10)
        assertEquals(16, span.first)
        assertFalse(PlayarrEllipsizedRun.holdsEllipsis(10, 16, span))
        assertTrue(PlayarrEllipsizedRun.holdsEllipsis(16, 20, span))
        assertFalse(PlayarrEllipsizedRun.holdsEllipsis(22, 26, span))
        assertEquals(Side.None, PlayarrEllipsizedRun.side(22, 26, span))
    }
}
