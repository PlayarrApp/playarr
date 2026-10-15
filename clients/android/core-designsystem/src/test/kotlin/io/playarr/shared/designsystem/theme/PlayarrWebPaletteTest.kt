package io.playarr.shared.designsystem.theme

import androidx.compose.ui.graphics.Color
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PlayarrWebPaletteTest {
    @Test
    fun accentIsNeutralInBothThemes() {
        assertEquals(Color(0xFFDFDCDD), PlayarrWebPalette.Dark.accent)
        assertEquals(Color(0xFF4D4248), PlayarrWebPalette.Light.accent) // web --accent (#1421: was the stale #675961)
    }

    @Test
    fun focusRingIsWhiteInDarkAndInkInLight() {
        assertEquals(Color.White, PlayarrWebPalette.Dark.focusRing)
        assertEquals(PlayarrWebPalette.Light.ink, PlayarrWebPalette.Light.focusRing)
        assertNotEquals(Color.White, PlayarrWebPalette.Light.focusRing)
    }

    @Test
    fun phoneCardGlowUsesWebCardAccentPerTheme() {
        assertEquals(Color(0xFFEAA6B6), PlayarrWebPalette.Dark.phoneCardGlow)
        assertEquals(Color(0xFFA52745), PlayarrWebPalette.Light.phoneCardGlow)
    }

    @Test
    fun webInkMutedMatchesBothWebThemesAndPhoneAlias() {
        assertEquals(Color(0xFFC2B5BB), PlayarrWebPalette.Dark.webInkMuted)
        assertEquals(Color(0xFF4D4248), PlayarrWebPalette.Light.webInkMuted)
        assertEquals(PlayarrWebPalette.Dark.webInkMuted, PlayarrWebPalette.Dark.phoneInkMuted)
        assertEquals(PlayarrWebPalette.Light.webInkMuted, PlayarrWebPalette.Light.phoneInkMuted)
    }

    @Test
    fun selectingATheme_changesTheObservablePalette() {
        PlayarrWebTheme.select(dark = false)
        assertEquals(PlayarrWebPalette.Light, PlayarrWebTheme.palette)
        PlayarrWebTheme.select(dark = true)
        assertTrue(PlayarrWebTheme.palette.dark)
    }

    @Test
    fun bothThemesDefineEveryToken() {
        for (palette in listOf(PlayarrWebPalette.Dark, PlayarrWebPalette.Light)) {
            val tokens = listOf(
                palette.background, palette.surface, palette.surfaceStrong, palette.surfaceSoft,
                palette.ink, palette.inkSoft, palette.inkMuted, palette.accent,
            )
            assertTrue(tokens.all { it != Color.Unspecified && it.alpha == 1f })
        }
    }
}
