package io.playarr.mobile.ui

import androidx.compose.ui.unit.dp
import org.junit.Assert.assertEquals
import org.junit.Test

class PlayarrHomeRailsLayoutTest {
    @Test
    fun `television opens the first rail at the library rail top`() {
        assertEquals(149.9.dp.value, homeFirstRailTop(true, 389.9.dp, 162.dp).value, 0.001f)
    }

    @Test
    fun `a tablet keeps the centred anchor`() {
        assertEquals(389.9.dp, homeFirstRailTop(false, 389.9.dp, 162.dp))
    }
}
