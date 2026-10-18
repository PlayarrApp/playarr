package io.playarr.mobile.ui

import org.junit.Test
import org.junit.Assert.assertEquals

class PhoneSettingsRowHeightTest {
    @Test
    fun rowsAddUpToTheUnroundedPitch() {
        val density = 295f / 160f
        val total = (0 until 6).sumOf { phoneSettingsRowHeightPx(it, density).toInt() }
        assertEquals(Math.round(6 * 88f * density), total)
        assertEquals(162f, phoneSettingsRowHeightPx(0, density), 0f)
    }
}
