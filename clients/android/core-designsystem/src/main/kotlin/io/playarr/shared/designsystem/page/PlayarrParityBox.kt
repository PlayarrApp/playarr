package io.playarr.shared.designsystem.page

import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.layout.onGloballyPositioned
import android.view.View
import androidx.compose.ui.semantics.semantics

/** Debug builds only: set before setContent so `parityBox` records nothing (and costs nothing) in a release build. */
var parityLayoutEnabled = false

class ParityBox(val view: View, var role: String, var label: String, var radius: Float, var opacity: Float, var background: androidx.compose.ui.graphics.Color, var fit: ((androidx.compose.ui.geometry.Rect) -> androidx.compose.ui.geometry.Rect)?, var bounds: androidx.compose.ui.geometry.Rect = androidx.compose.ui.geometry.Rect.Zero)

val parityBoxes = java.util.Collections.synchronizedSet(java.util.LinkedHashSet<ParityBox>())

/**
 * Records this node's window bounds for the layout export (docs/parity/LAYOUT.md): a painted container, an image, a control
 * (cards are `link` with their accessible name, as the web's `Open <title>` links). A no-op unless the debug build enabled it.
 */
fun Modifier.parityBox(role: String, label: String = "", radius: Float = 0f, opacity: Float = 1f, background: androidx.compose.ui.graphics.Color = androidx.compose.ui.graphics.Color.Unspecified, fit: ((androidx.compose.ui.geometry.Rect) -> androidx.compose.ui.geometry.Rect)? = null): Modifier =
    if (!parityLayoutEnabled) this else composed {
        val view = androidx.compose.ui.platform.LocalView.current
        val box = remember { ParityBox(view, role, label, radius, opacity, background, fit) }
        box.role = role; box.label = label; box.radius = radius; box.opacity = opacity; box.background = background; box.fit = fit
        DisposableEffect(box) { parityBoxes.add(box); onDispose { parityBoxes.remove(box) } }
        onGloballyPositioned {
            // Corners through the layers, unclipped: the web exports boxes that run past the viewport edge.
            val a = it.localToWindow(androidx.compose.ui.geometry.Offset.Zero); val b = it.localToWindow(androidx.compose.ui.geometry.Offset(it.size.width.toFloat(), it.size.height.toFloat()))
            box.bounds = androidx.compose.ui.geometry.Rect(minOf(a.x, b.x), minOf(a.y, b.y), maxOf(a.x, b.x), maxOf(a.y, b.y))
        }
    }


/** Debug layout export: the web role of a text node whose element is itself the control (a label pill exports as a `button` run). */
val ParityRoleKey = androidx.compose.ui.semantics.SemanticsPropertyKey<String>("ParityRole")
private var androidx.compose.ui.semantics.SemanticsPropertyReceiver.parityRoleProp by ParityRoleKey

val ParityRadiusKey = androidx.compose.ui.semantics.SemanticsPropertyKey<Float>("ParityRadius")
private var androidx.compose.ui.semantics.SemanticsPropertyReceiver.parityRadiusProp by ParityRadiusKey

fun Modifier.parityRole(role: String, radius: Float = 0f): Modifier = semantics { parityRoleProp = role; if (radius > 0f) parityRadiusProp = radius }
