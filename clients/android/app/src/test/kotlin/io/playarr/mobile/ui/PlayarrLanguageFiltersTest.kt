package io.playarr.mobile.ui

import io.playarr.mobile.connected.mergeLanguageFacets
import io.playarr.shared.data.model.LanguageFacetEntry
import java.io.File
import java.util.Locale
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PlayarrLanguageFiltersTest {
    @Test
    fun `selection toggles and renders sorted query parameters`() {
        val selection = LanguageSelection().toggleAudio("ja").toggleAudio("en").toggleSubtitle("fr")
        assertEquals("en,ja", selection.audioParam)
        assertEquals("fr", selection.subtitleParam)
        assertEquals(null, selection.toggleSubtitle("fr").subtitleParam)
        assertEquals("en", selection.toggleAudio("ja").audioParam)
        assertTrue(LanguageSelection().isEmpty)
        assertNull(LanguageSelection().audioParam)
    }

    @Test
    fun `names are localised and fall back to the server name or code`() {
        assertEquals("Japanese", languageDisplayName("ja", Locale.ENGLISH))
        assertEquals("日本語", languageDisplayName("ja", Locale.JAPANESE))
        assertEquals("Fallback", languageDisplayName("xx", Locale.ENGLISH, "Fallback"))
    }

    @Test
    fun `joined servers merge language counts`() {
        val merged = mergeLanguageFacets(
            listOf(
                listOf(LanguageFacetEntry("en", "English", 2), LanguageFacetEntry("ja", null, 1)),
                listOf(LanguageFacetEntry("ja", "Japanese", 4)),
            ),
        )
        assertEquals(listOf("ja", "en"), merged.map { it.code })
        assertEquals(5L, merged.first().count)
        assertEquals("Japanese", merged.first().name)
    }

    @Test
    fun `selected languages remain available when their facet disappears and are listed first`() {
        val entries = libraryLanguageEntries(
            listOf(LanguageFacetEntry("en", "English", 4), LanguageFacetEntry("ja", "Japanese", 8)),
            setOf("fr", "en"),
        )
        assertEquals(listOf("en", "fr", "ja"), entries.map { it.code })
        assertEquals(-1L, entries[1].count)
    }

    @Test
    fun `TV filters use a closed vertical language picker, back restores its trigger, and view choices keep icons`() {
        val base = if (File("src/main").isDirectory) File(".") else File("clients/android/app")
        val source = File(base, "src/main/kotlin/io/playarr/mobile/ui/PlayarrExperience.kt").readText()
        assertTrue(source.contains("private fun TvLanguageMultiSelect("))
        assertTrue(source.contains("BackHandler(enabled = open)"))
        assertTrue(source.contains("triggerFocus.requestFocus()"))
        assertTrue(source.contains("focusedLanguageCode = orderedEntries.firstOrNull()?.code"))
        assertTrue(source.contains("focusRequester(optionFocus.getValue(entry.code))"))
        assertTrue(source.contains("webFocusRing(focused, radius = 8.dp, offset = 2.dp)"))
        assertTrue(source.contains("webFocusRing(triggerFocused, radius = 10.dp, offset = 2.dp)"))
        assertTrue(source.contains("LazyColumn("))
        assertTrue(source.contains("icon = icon?.let { draw -> { colour -> draw(value, colour) } }) { onSelected(value) }"))
        assertTrue(source.contains("fontSize = 11.84.sp, lineHeight = 17.76.sp"))
        assertTrue(source.contains("LibraryViewMode.List -> Triple(3, 20f, if (tv) 3f else 2f)"))
        assertTrue(source.contains("LibraryViewMode.Screen -> if (tv) Triple(3, 5.33f, 13f) else Triple(3, 5.5f, 3.9f)"))
        assertTrue(source.contains("if (list && !tv) it.background(colour, RoundedCornerShape(1.dp)) else it.border(1.dp, colour, RoundedCornerShape(1.dp))"))

        assertTrue(source.contains("suppressFocusedCardVisuals = isTelevision && contextWork != null"))

        val actionPill = File(base, "../core-designsystem/src/main/kotlin/io/playarr/shared/designsystem/page/PlayarrActionPill.kt")
            .takeIf { it.isFile }
            ?: File("clients/android/core-designsystem/src/main/kotlin/io/playarr/shared/designsystem/page/PlayarrActionPill.kt")
        assertTrue(actionPill.readText().contains("focused && !(tv && active && suppressFocusRingWhenActive)"))
        val layout = File(base, "../core-designsystem/src/main/kotlin/io/playarr/shared/designsystem/page/PlayarrPageLayout.kt")
            .takeIf { it.isFile }
            ?: File("clients/android/core-designsystem/src/main/kotlin/io/playarr/shared/designsystem/page/PlayarrPageLayout.kt")
        assertTrue(layout.readText().contains("suppressFocusRingWhenActive = true"))
    }

    @Test
    fun `opening the library filters sheet loads the language facets`() {
        val base = if (File("src/main").isDirectory) File(".") else File("clients/android/app")
        val source = File(base, "src/main/kotlin/io/playarr/mobile/ui/PlayarrExperience.kt").readText()
        // setLanguageSelection refreshes the facets after a change; the sheet itself must also load them
        // when it opens, or the first visit shows an empty language list.
        val effect = Regex("""LaunchedEffect\(kind, filtersOpen\)\s*\{[^}]*loadLanguageFacets\(kind, languageSelection\)""")
        assertTrue("the library screen must load language facets when the filters sheet opens", effect.containsMatchIn(source))
    }

    @Test
    fun `TV library Filters sends Left to its selected content item and consumes empty edges`() {
        val base = if (File("src/main").isDirectory) File(".") else File("clients/android/app")
        val experience = File(base, "src/main/kotlin/io/playarr/mobile/ui/PlayarrExperience.kt").readText()
        assertTrue(experience.contains("onLeft = if (isTelevision)"))
        assertTrue(experience.contains("if (filteredWorks.isNotEmpty())"))
        assertTrue(experience.contains("filteredWorks.indexOfFirst { it.id == selectedId }.coerceAtLeast(0)"))
        assertTrue(experience.contains("libraryScope.launch { tvGrid.focus(0, selectedIndex) }"))

        val actionPill = File(base, "../core-designsystem/src/main/kotlin/io/playarr/shared/designsystem/page/PlayarrActionPill.kt")
            .takeIf { it.isFile }
            ?: File("clients/android/core-designsystem/src/main/kotlin/io/playarr/shared/designsystem/page/PlayarrActionPill.kt")
        val pillSource = actionPill.readText()
        assertTrue(pillSource.contains("if (tv && onLeft != null)"))
        assertTrue(pillSource.contains("event.key == Key.DirectionLeft && event.type == KeyEventType.KeyDown"))
        assertTrue(pillSource.contains("onLeft()\n                                true"))

        val layout = File(base, "../core-designsystem/src/main/kotlin/io/playarr/shared/designsystem/page/PlayarrPageLayout.kt")
            .takeIf { it.isFile }
            ?: File("clients/android/core-designsystem/src/main/kotlin/io/playarr/shared/designsystem/page/PlayarrPageLayout.kt")
        assertTrue(layout.readText().contains("onLeft = action.onLeft"))
    }
}
