package io.playarr.mobile.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.isTraversalGroup
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.semantics

/** The single in-activity phone drawer. It keeps the existing navigation in the activity window. */
internal class PhoneDrawerHostState {
    var activePane by mutableStateOf<PhoneDrawerPane?>(null)
        private set

    fun register(pane: PhoneDrawerPane) {
        val previous = activePane
        if (previous?.owner !== pane.owner) {
            activePane = null
            previous?.onDismiss?.invoke()
        }
        activePane = pane
    }

    fun unregister(owner: Any) {
        if (activePane?.owner === owner) activePane = null
    }

    fun dismiss() {
        val pane = activePane ?: return
        if (!pane.dismissible) return
        activePane = null
        pane.onDismiss()
    }

    fun routeChanged(route: String) {
        val pane = activePane?.takeIf { it.route != route } ?: return
        activePane = null
        pane.onDismiss()
    }
}

internal data class PhoneDrawerPane(
    val owner: Any,
    val route: String,
    val title: String,
    val dismissible: Boolean,
    val onDismiss: () -> Unit,
    val content: @Composable () -> Unit,
)

internal val LocalPhoneDrawerHost = staticCompositionLocalOf<PhoneDrawerHostState?> { null }
internal val LocalPhoneDrawerRoute = staticCompositionLocalOf { "" }

@Composable
internal fun PhoneDrawerHostPane(
    host: PhoneDrawerHostState,
    route: String,
) {
    val pane = host.activePane?.takeIf { it.route == route } ?: return
    BackHandler(onBack = host::dismiss)
    Box(
        Modifier.fillMaxSize()
            .semantics {
                paneTitle = pane.title
                isTraversalGroup = true
            },
    ) {
        pane.content()
    }
}
