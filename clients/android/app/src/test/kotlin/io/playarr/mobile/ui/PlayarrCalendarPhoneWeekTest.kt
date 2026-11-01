package io.playarr.mobile.ui

import org.junit.Assert.assertEquals
import org.junit.Test

class PlayarrCalendarPhoneWeekTest {
    @Test
    fun columnsStartOneToolbarGapBelowTheToolbar() {
        assertEquals(0.75 * 16, PHONE_WEEK_TOP_PAD_DP.toDouble(), 0.0)
    }

    @Test
    fun headingMarginAndEntryGapAreTheCssRems() {
        assertEquals(0.4 * 16, PHONE_WEEK_HEADING_MARGIN_DP.toDouble(), 0.05)
        assertEquals(0.85 * 16, PHONE_WEEK_ENTRY_GAP_DP.toDouble(), 0.05)
    }
}
