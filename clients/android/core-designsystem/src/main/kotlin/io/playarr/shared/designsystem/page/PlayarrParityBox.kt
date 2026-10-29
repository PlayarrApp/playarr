package io.playarr.shared.designsystem.page

import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.foundation.background
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.boundsInWindow
import android.view.View
import androidx.compose.ui.semantics.semantics

/** Debug builds only: set before setContent so `parityBox` records nothing (and costs nothing) in a release build. */
var parityLayoutEnabled = false

/**
 * A painted box the layout export reads: only its measured bounds (through every layer transform), its kind (container, image or img)
 * and the alpha and corner radius the composable itself draws with. [fill] is set at paint time by [parityBackground], from the colour handed to the draw call.
 */
class ParityBox(val view: View, var kind: String, var radius: Float, var opacity: Float, var fillAlpha: Float = 1f) {
    var coordinates: androidx.compose.ui.layout.LayoutCoordinates? = null
    var density: Float = 1f
    var fill: androidx.compose.ui.graphics.Color = androidx.compose.ui.graphics.Color.Unspecified

    /** The box's four corners through the layers right now (a graphicsLayer animation does not call onGloballyPositioned), or null once detached. */
    fun bounds(): androidx.compose.ui.geometry.Rect? {
        val c = coordinates?.takeIf { it.isAttached } ?: return null
        val a = c.localToWindow(androidx.compose.ui.geometry.Offset.Zero); val b = c.localToWindow(androidx.compose.ui.geometry.Offset(c.size.width.toFloat(), c.size.height.toFloat()))
        return androidx.compose.ui.geometry.Rect(minOf(a.x, b.x), minOf(a.y, b.y), maxOf(a.x, b.x), maxOf(a.y, b.y))
    }

    /** What is visible of the box: its window bounds clipped by every ancestor clip, or null when nothing shows. */
    fun visible(): androidx.compose.ui.geometry.Rect? {
        val c = coordinates?.takeIf { it.isAttached } ?: return null
        val r = c.boundsInWindow()
        return if (r.width > 0f && r.height > 0f) r else null
    }

    /** The scale the layers put on the box (window width over layout width), for the radius it draws. */
    fun scale(): Float {
        val c = coordinates?.takeIf { it.isAttached && it.size.width > 0 } ?: return 1f
        val a = c.localToWindow(androidx.compose.ui.geometry.Offset.Zero); val b = c.localToWindow(androidx.compose.ui.geometry.Offset(c.size.width.toFloat(), 0f))
        return Math.hypot((b.x - a.x).toDouble(), (b.y - a.y).toDouble()).toFloat() / c.size.width
    }
}

val parityBoxes = java.util.Collections.synchronizedSet(java.util.LinkedHashSet<ParityBox>())

/**
 * Records this node's bounds for the layout export (docs/parity/LAYOUT.md). Only for something the composable paints itself: a filled or
 * clipped container (`container`), an image or icon (`image`) or a status dot (`img`). Controls, headings and text are read from the semantics tree.
 * [fillAlpha] is the alpha of the fill the box paints; a box painted at 0.5 or more covers what lies under it in lower windows.
 * [radius] is the dp corner radius the shape really uses (999 for a CircleShape); the export clamps it to half the measured short side.
 */
fun Modifier.parityBox(kind: String, radius: Float = 0f, opacity: Float = 1f, fillAlpha: Float = 1f): Modifier =
    if (!parityLayoutEnabled) this else composed {
        val view = androidx.compose.ui.platform.LocalView.current
        val box = remember { ParityBox(view, kind, radius, opacity, fillAlpha) }
        box.density = androidx.compose.ui.platform.LocalDensity.current.density; box.kind = kind; box.radius = radius; box.opacity = opacity; box.fillAlpha = fillAlpha
        DisposableEffect(box) { parityBoxes.add(box); onDispose { box.coordinates = null; parityBoxes.remove(box) } }
        onGloballyPositioned { box.coordinates = it }
    }

/**
 * [parityBox] plus the background itself: draws `color` in `shape` and records, in the draw call, the colour it painted (alpha included),
 * so the export reads the app's own paint and not a copy of it.
 */
fun Modifier.parityBackground(kind: String, color: androidx.compose.ui.graphics.Color, shape: androidx.compose.ui.graphics.Shape = androidx.compose.ui.graphics.RectangleShape, radius: Float = 0f, opacity: Float = 1f): Modifier =
    if (!parityLayoutEnabled) this.background(color, shape) else composed {
        val view = androidx.compose.ui.platform.LocalView.current
        val box = remember { ParityBox(view, kind, radius, opacity, color.alpha) }
        box.density = androidx.compose.ui.platform.LocalDensity.current.density; box.kind = kind; box.radius = radius; box.opacity = opacity; box.fillAlpha = color.alpha
        DisposableEffect(box) { parityBoxes.add(box); onDispose { box.coordinates = null; parityBoxes.remove(box) } }
        this.onGloballyPositioned { box.coordinates = it }.background(color, shape).drawBehind { box.fill = color }
    }

/**
 * [parityBox] for a node that paints its own fill some other way (a Surface colour, a glass tint, a border-only shape): draws nothing, only records
 * in the draw call the colour (alpha included) this node paints, so a control's own fill is exported and not the page behind it.
 */
fun Modifier.parityPainted(kind: String, color: androidx.compose.ui.graphics.Color, radius: Float = 0f, opacity: Float = 1f): Modifier =
    if (!parityLayoutEnabled) this else composed {
        val view = androidx.compose.ui.platform.LocalView.current
        val box = remember { ParityBox(view, kind, radius, opacity, color.alpha) }
        box.density = androidx.compose.ui.platform.LocalDensity.current.density; box.kind = kind; box.radius = radius; box.opacity = opacity; box.fillAlpha = color.alpha
        DisposableEffect(box) { parityBoxes.add(box); onDispose { box.coordinates = null; parityBoxes.remove(box) } }
        this.onGloballyPositioned { box.coordinates = it }.drawBehind { box.fill = color }
    }

/** The corner radius (dp) of the shape a control draws (999 for a CircleShape). Never merged into a parent: a descendant's shape is not the parent's. */
val ParityRadiusKey = androidx.compose.ui.semantics.SemanticsPropertyKey<Float>("ParityRadius") { parent, _ -> parent }
private var androidx.compose.ui.semantics.SemanticsPropertyReceiver.parityRadiusProp by ParityRadiusKey

/** The alpha this control is drawn with (a graphicsLayer alpha on the control itself). */
val ParityAlphaKey = androidx.compose.ui.semantics.SemanticsPropertyKey<Float>("ParityAlpha") { parent, _ -> parent }
private var androidx.compose.ui.semantics.SemanticsPropertyReceiver.parityAlphaProp by ParityAlphaKey

fun Modifier.parityShape(radius: Float, alpha: Float = 1f): Modifier = if (!parityLayoutEnabled) this else semantics { parityRadiusProp = radius; if (alpha < 1f) parityAlphaProp = alpha }

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
