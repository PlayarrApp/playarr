package io.playarr.shared.designsystem.page

import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.SemanticsPropertyKey
import androidx.compose.ui.semantics.SemanticsPropertyReceiver
import androidx.compose.ui.semantics.semantics

/**
 * A clickable that navigates to another page or route (a web anchor) rather than performing an action (a web button). Android has no link role for a
 * node, so the app says it with its own semantics property; the layout export reads it as the element's role.
 */
val PlayarrNavigatesKey = SemanticsPropertyKey<Boolean>("PlayarrNavigates")
var SemanticsPropertyReceiver.playarrNavigates by PlayarrNavigatesKey

/** Marks the clickable as navigating (television; the other form factors keep the control role until their own references are checked). */
@androidx.compose.runtime.Composable
fun Modifier.playarrLink(enabled: Boolean = true): Modifier =
    if (enabled && LocalPlayarrFormFactor.current == PlayarrFormFactor.Tv) this.semantics { playarrNavigates = true } else this
