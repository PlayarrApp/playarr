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

class ParityBox(val view: View, var role: String, var label: String, var radius: Float, var opacity: Float, var background: androidx.compose.ui.graphics.Color, var fit: ((androidx.compose.ui.geometry.Rect) -> androidx.compose.ui.geometry.Rect)?, var style: Triple<Float, Int, androidx.compose.ui.graphics.Color>?, var bounds: androidx.compose.ui.geometry.Rect = androidx.compose.ui.geometry.Rect.Zero, var density: Float = 1f) {
    var coordinates: androidx.compose.ui.layout.LayoutCoordinates? = null

    /** Window bounds through the layers right now: a graphicsLayer animation does not call onGloballyPositioned, so the recorded bounds can be stale. */
    fun refresh() {
        val it = coordinates?.takeIf { c -> c.isAttached } ?: return
        val a = it.localToWindow(androidx.compose.ui.geometry.Offset.Zero); val b = it.localToWindow(androidx.compose.ui.geometry.Offset(it.size.width.toFloat(), it.size.height.toFloat()))
        bounds = androidx.compose.ui.geometry.Rect(minOf(a.x, b.x), minOf(a.y, b.y), maxOf(a.x, b.x), maxOf(a.y, b.y))
    }
}

val parityBoxes = java.util.Collections.synchronizedSet(java.util.LinkedHashSet<ParityBox>())

/**
 * Records this node's window bounds for the layout export (docs/parity/LAYOUT.md): a painted container, an image, a control
 * (cards are `link` with their accessible name, as the web's `Open <title>` links). A no-op unless the debug build enabled it.
 */
fun Modifier.parityBox(role: String, label: String = "", radius: Float = 0f, opacity: Float = 1f, background: androidx.compose.ui.graphics.Color = androidx.compose.ui.graphics.Color.Unspecified, fit: ((androidx.compose.ui.geometry.Rect) -> androidx.compose.ui.geometry.Rect)? = null, style: Triple<Float, Int, androidx.compose.ui.graphics.Color>? = null): Modifier =
    if (!parityLayoutEnabled) this else composed {
        val view = androidx.compose.ui.platform.LocalView.current
        val box = remember { ParityBox(view, role, label, radius, opacity, background, fit, style) }
        box.density = androidx.compose.ui.platform.LocalDensity.current.density; box.role = role; box.label = label; box.radius = radius; box.opacity = opacity; box.background = background; box.fit = fit; box.style = style
        DisposableEffect(box) { parityBoxes.add(box); onDispose { parityBoxes.remove(box) } }
        onGloballyPositioned {
            box.coordinates = it
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

val ParityLineBoxKey = androidx.compose.ui.semantics.SemanticsPropertyKey<Boolean>("ParityLineBox")
private var androidx.compose.ui.semantics.SemanticsPropertyReceiver.parityLineBoxProp by ParityLineBoxKey

val ParityBgKey = androidx.compose.ui.semantics.SemanticsPropertyKey<Long>("ParityBg")
private var androidx.compose.ui.semantics.SemanticsPropertyReceiver.parityBgProp by ParityBgKey

fun Modifier.parityRole(role: String, radius: Float = 0f): Modifier = semantics { parityRoleProp = role; if (radius > 0f) parityRadiusProp = radius }

/** Layout export for a text run: its web role and radius, the raw DOM text where the web shows a CSS-transformed string, and the flat colour behind it. */
fun Modifier.parityText(role: String? = null, radius: Float = 0f, background: androidx.compose.ui.graphics.Color = androidx.compose.ui.graphics.Color.Unspecified): Modifier = semantics {
    if (role != null) parityRoleProp = role
    if (radius > 0f) parityRadiusProp = radius
    if (background != androidx.compose.ui.graphics.Color.Unspecified) parityBgProp = background.value.toLong()
}

/** Layout export: this text's web run box is its CSS line box (the element's own line-height), not the font's content area. */
fun Modifier.parityLineBox(): Modifier = semantics { parityLineBoxProp = true }

/**
 * `Arrangement.spacedBy` rounds every gap to whole pixels, so a CSS gap of 13.6 px drifts 0.4 px per item. This arrangement keeps the
 * running position in float and rounds each child's own position once (left to right), as a browser lays out inline boxes.
 */
@androidx.compose.runtime.Immutable
class FractionalSpacedArrangement(private val gap: androidx.compose.ui.unit.Dp, private val flushEnd: Boolean = false) : androidx.compose.foundation.layout.Arrangement.Horizontal {
    override val spacing: androidx.compose.ui.unit.Dp get() = gap
    override fun androidx.compose.ui.unit.Density.arrange(totalSize: Int, sizes: IntArray, layoutDirection: androidx.compose.ui.unit.LayoutDirection, outPositions: IntArray) {
        var position = 0f
        val g = gap.toPx()
        for (i in sizes.indices) {
            outPositions[i] = Math.round(position)
            position += sizes[i] + g
        }
        // The row sized its flexible spacer with whole-pixel gaps: give the difference to the children after it, so the right edge stays flush.
        if (flushEnd && sizes.isNotEmpty()) {
            val spacer = sizes.indices.maxByOrNull { sizes[it] } ?: 0
            val shift = totalSize - (outPositions.last() + sizes.last())
            if (shift != 0) for (i in spacer + 1 until sizes.size) outPositions[i] += shift
        }
    }
}

/** Vertical twin of [FractionalSpacedArrangement]: a CSS gap such as 29.63 px, accumulated in float and rounded once per child. */
@androidx.compose.runtime.Immutable
class FractionalSpacedVertical(private val gap: androidx.compose.ui.unit.Dp) : androidx.compose.foundation.layout.Arrangement.Vertical {
    override val spacing: androidx.compose.ui.unit.Dp get() = gap
    override fun androidx.compose.ui.unit.Density.arrange(totalSize: Int, sizes: IntArray, outPositions: IntArray) {
        var position = 0f
        val g = gap.toPx()
        for (i in sizes.indices) {
            outPositions[i] = Math.round(position)
            position += sizes[i] + g
        }
    }
}

private fun over(top: androidx.compose.ui.graphics.Color, alpha: Float, under: androidx.compose.ui.graphics.Color) =
    androidx.compose.ui.graphics.Color(top.red * alpha + under.red * (1 - alpha), top.green * alpha + under.green * (1 - alpha), top.blue * alpha + under.blue * (1 - alpha))

/** Layout export: the web composites translucent fills over the page, so these are the flat colours the DOM dump reports. */
fun parityNavGlass(): androidx.compose.ui.graphics.Color = io.playarr.shared.designsystem.theme.PlayarrWebTheme.palette.let { over(it.surfaceStrong, 0.56f, it.background) }
fun parityNavSelected(): androidx.compose.ui.graphics.Color = io.playarr.shared.designsystem.theme.PlayarrWebTheme.palette.let { over(it.ink, 0.09f, parityNavGlass()) }
fun parityPillGlass(): androidx.compose.ui.graphics.Color = io.playarr.shared.designsystem.theme.PlayarrWebTheme.palette.let { over(it.surfaceStrong, 0.78f, it.background) }

/** Layout export: the flat colour under the current panel (a drawer is `--surface-strong`, a page `--surface`); translucent fills are composited over it. */
val LocalParityUnder = androidx.compose.runtime.compositionLocalOf { androidx.compose.ui.graphics.Color.Unspecified }

fun parityOver(top: androidx.compose.ui.graphics.Color, alpha: Float, under: androidx.compose.ui.graphics.Color) = over(top, alpha, under)
