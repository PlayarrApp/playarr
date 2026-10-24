package io.playarr.shared.designsystem.page

import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color

/**
 * Debug-build layout export hook (docs/parity/LAYOUT.md). The registry lives in the app module (`parityBox`); design-system
 * components tag themselves through this hook, which the debug app sets at start-up. In release builds [box] stays null and
 * [parityTag] returns the modifier untouched.
 */
object PlayarrParityHook {
    var box: ((Modifier, String, String, Float, Boolean, Color, Float) -> Modifier)? = null
}

/** Records this node for the layout export: [role] is a schema role, [radiusDp] a corner radius in dp, [circle] a 50% radius. */
fun Modifier.parityTag(
    role: String,
    label: String = "",
    radiusDp: Float = 0f,
    circle: Boolean = false,
    background: Color = Color.Unspecified,
    opacity: Float = 1f,
): Modifier = PlayarrParityHook.box?.invoke(this, role, label, radiusDp, circle, background, opacity) ?: this
