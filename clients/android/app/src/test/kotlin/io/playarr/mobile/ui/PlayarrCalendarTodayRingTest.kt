package io.playarr.mobile.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PlayarrCalendarTodayRingTest {
    @Test
    fun ringSitsOutsideThePillByOffsetPlusHalfTheStroke() {
        val ring = phoneTodayRing(width = 100f, height = 44f, stroke = 2f, offset = 3f)
        assertEquals(-4f, ring.left, 0f)
        assertEquals(-4f, ring.top, 0f)
        assertEquals(108f, ring.width, 0f)
        assertEquals(52f, ring.height, 0f)
    }

    @Test
    fun todayIsRingedWhenTheCalendarOpens() {
        assertTrue(phoneCalendarTodayRingOnOpen())
    }
}
