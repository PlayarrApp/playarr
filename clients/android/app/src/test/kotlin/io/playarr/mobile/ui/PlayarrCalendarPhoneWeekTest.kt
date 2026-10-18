package io.playarr.mobile.ui

import org.junit.Assert.assertEquals
import org.junit.Test

class PlayarrCalendarPhoneWeekTest {
    private val devicePxPerDp = 719.0 / 390.0

    @Test
    fun headingSitsFourDevicePxHigherThanBefore() {
        assertEquals(7.0 - 4.0 / devicePxPerDp, PHONE_WEEK_TOP_PAD_DP, 0.05)
    }

    @Test
    fun firstCardSitsTenDevicePxHigherThanBefore() {
        // Previously 7 dp padding plus a 38 dp heading row; the web ref puts the first card 10 device px higher in total.
        assertEquals(45.0 - 10.0 / devicePxPerDp, PHONE_WEEK_TOP_PAD_DP + PHONE_WEEK_HEADING_ROW_DP, 0.05)
    }
}
