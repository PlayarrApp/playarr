package io.playarr.mobile.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Test

class PhoneDrawerHostStateTest {
    @Test
    fun `only the latest route pane remains active and replacing it dismisses its owner`() {
        val host = PhoneDrawerHostState()
        val firstOwner = Any()
        val secondOwner = Any()
        var firstDismissals = 0

        host.register(pane(firstOwner, "movies") { firstDismissals++ })
        host.register(pane(secondOwner, "calendar"))

        assertEquals(1, firstDismissals)
        assertSame(secondOwner, host.activePane?.owner)
        assertEquals("calendar", host.activePane?.route)
    }

    @Test
    fun `disposing an old pane cannot unregister its replacement`() {
        val host = PhoneDrawerHostState()
        val oldOwner = Any()
        val currentOwner = Any()

        host.register(pane(oldOwner, "movies"))
        host.register(pane(currentOwner, "series"))
        host.unregister(oldOwner)

        assertSame(currentOwner, host.activePane?.owner)
    }

    @Test
    fun `route changes dismiss and clear the pane before notifying its owner`() {
        val host = PhoneDrawerHostState()
        val owner = Any()
        var dismissedWithClearedHost = false
        host.register(
            pane(owner, "filters") {
                dismissedWithClearedHost = host.activePane == null
            },
        )

        host.routeChanged("movies")

        assertNull(host.activePane)
        assertEquals(true, dismissedWithClearedHost)
    }

    @Test
    fun `same-route changes preserve the active pane`() {
        val host = PhoneDrawerHostState()
        val owner = Any()
        var dismissals = 0
        host.register(pane(owner, "calendar") { dismissals++ })

        host.routeChanged("calendar")

        assertSame(owner, host.activePane?.owner)
        assertEquals(0, dismissals)
    }

    @Test
    fun `back dismissal clears the modal before notifying the owner`() {
        val host = PhoneDrawerHostState()
        val owner = Any()
        var dismissedWithClearedHost = false
        host.register(
            pane(owner, "filters") {
                dismissedWithClearedHost = host.activePane == null
            },
        )

        host.dismiss()

        assertNull(host.activePane)
        assertEquals(true, dismissedWithClearedHost)
    }

    @Test
    fun `non-dismissible panes ignore back dismissal`() {
        val host = PhoneDrawerHostState()
        val owner = Any()
        var dismissals = 0
        host.register(pane(owner, "pairing", dismissible = false) { dismissals++ })

        host.dismiss()

        assertSame(owner, host.activePane?.owner)
        assertEquals(0, dismissals)
    }

    @Test
    fun `route changes clear even non-dismissible panes and notify their owners`() {
        val host = PhoneDrawerHostState()
        val owner = Any()
        var dismissals = 0
        host.register(pane(owner, "pairing", dismissible = false) { dismissals++ })

        host.routeChanged("movies")

        assertNull(host.activePane)
        assertEquals(1, dismissals)
    }

    private fun pane(owner: Any, route: String, dismissible: Boolean = true, onDismiss: () -> Unit = {}) = PhoneDrawerPane(
        owner = owner,
        route = route,
        title = "Filters",
        dismissible = dismissible,
        onDismiss = onDismiss,
        content = {},
    )
}
