package io.playarr.shared.designsystem.page

import androidx.compose.ui.unit.dp
import org.junit.Assert.assertEquals
import org.junit.Test

/** Pins the page chrome measurements to docs/design/page-layout.md section 3. */
class PlayarrPageTokensTest {
    @Test
    fun televisionTokensMatchTheSpec() {
        val tv = PlayarrPageTokens.of(PlayarrFormFactor.Tv)
        assertEquals(56.dp, tv.headerTop)
        assertEquals(154.dp, tv.start)
        assertEquals(76.8.dp, tv.headerEnd)
        assertEquals(50.dp, tv.control)
        assertEquals(62.dp, tv.pillWidth)
        assertEquals(72.dp, tv.pillHeight)
        assertEquals(14.dp, tv.pillRadius)
        assertEquals(23.dp, tv.headerGap)
        assertEquals(96.dp, tv.safeBottom)
        assertEquals(3.dp, tv.focusRingWidth)
        assertEquals(2.dp, tv.focusRingOffset)
    }

    @Test
    fun phoneTokensMatchTheSpec() {
        val phone = PlayarrPageTokens.of(PlayarrFormFactor.Phone)
        assertEquals(2.dp, phone.headerTop)
        assertEquals(16.dp, phone.start)
        assertEquals(16.dp, phone.headerEnd)
        assertEquals(16.dp, phone.bodyEnd)
        assertEquals(44.dp, phone.control)
        assertEquals(44.dp, phone.pillWidth)
        assertEquals(44.dp, phone.pillHeight)
        assertEquals(72.dp, phone.safeBottom)
        assertEquals(2.dp, phone.focusRingWidth)
        assertEquals(3.dp, phone.focusRingOffset)
    }

    @Test
    fun theHeaderRowGrowsToTheTile() {
        assertEquals(72.dp, PlayarrPageTokens.Tv.headerHeight)
        assertEquals(44.dp, PlayarrPageTokens.Phone.headerHeight)
    }

    @Test
    fun aTabletHeaderTakesWebsViewportClamps() {
        val scale = 1280f / 1920f
        val tablet = PlayarrPageTokens.tvFor(1280f, 800f, scale)
        // Web at 1280 px: Back is 44 css px, the Home header gap clamp(14, 1.2 vw, 24) is 15.36 css px.
        assertEquals(44f / scale, tablet.control.value, 0.01f)
        assertEquals(44f / scale, tablet.controlWidth.value, 0.01f)
        assertEquals(15.36f / scale, tablet.headerGap.value, 0.01f)
        assertEquals(9.92f / scale, tablet.subtitleSize, 0.01f)
        val tv = PlayarrPageTokens.tvFor(1920f, 1080f, 1f)
        assertEquals(50.dp, tv.control)
        assertEquals(62.dp, tv.pillWidth)
        assertEquals(72.dp, tv.pillHeight)
    }
}
