package io.playarr.shared.designsystem.page

import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.foundation.background as foundationBackground
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.drawWithContent
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
    /** True once a gradient or other brush fill was handed to the draw call (its colour is not one value, so [fill] stays unspecified). */
    var brushPainted = false
    val id: Int = nextParityBoxId.incrementAndGet()
    val semanticsKey = newParityBoxKey()
    var coordinates: androidx.compose.ui.layout.LayoutCoordinates? = null
    var density: Float = 1f
    var fill: androidx.compose.ui.graphics.Color = androidx.compose.ui.graphics.Color.Unspecified
    /** The corner radius (local px) of the outline the shape really resolved to at paint time, or null when it was not a rectangle or rounded rectangle. */
    var drawnRadiusPx: Float? = null

    /** The box's four corners through the layers right now (a graphicsLayer animation does not call onGloballyPositioned), or null once detached. */
    fun bounds(): androidx.compose.ui.geometry.Rect? {
        val c = coordinates?.takeIf { it.isAttached } ?: return null
        val w = c.size.width.toFloat(); val h = c.size.height.toFloat()
        val corners = listOf(androidx.compose.ui.geometry.Offset.Zero, androidx.compose.ui.geometry.Offset(w, 0f), androidx.compose.ui.geometry.Offset(0f, h), androidx.compose.ui.geometry.Offset(w, h)).map { c.localToWindow(it) }
        return androidx.compose.ui.geometry.Rect(corners.minOf { it.x }, corners.minOf { it.y }, corners.maxOf { it.x }, corners.maxOf { it.y })
    }

    /** What is visible of the box: its window bounds clipped by every ancestor clip, or null when nothing shows. */
    fun visible(): androidx.compose.ui.geometry.Rect? {
        val c = coordinates?.takeIf { it.isAttached } ?: return null
        val r = c.boundsInWindow()
        return if (r.width > 0f && r.height > 0f) r else null
    }

    /**
     * The scale the layers put on the box, for the radius it draws: the geometric mean of the scale along its width and along its height (both layout axes, so an unequal
     * scale or a rotation does not read one axis only). A uniform scale gives that scale itself.
     */
    fun scale(): Float {
        val c = coordinates?.takeIf { it.isAttached && it.size.width > 0 && it.size.height > 0 } ?: return 1f
        val w = c.size.width.toFloat(); val h = c.size.height.toFloat()
        val o = c.localToWindow(androidx.compose.ui.geometry.Offset.Zero)
        val x = c.localToWindow(androidx.compose.ui.geometry.Offset(w, 0f)); val y = c.localToWindow(androidx.compose.ui.geometry.Offset(0f, h))
        val sx = Math.hypot((x.x - o.x).toDouble(), (x.y - o.y).toDouble()) / w
        val sy = Math.hypot((y.x - o.x).toDouble(), (y.y - o.y).toDouble()) / h
        return Math.sqrt(sx * sy).toFloat()
    }
}

private val nextParityBoxId = java.util.concurrent.atomic.AtomicInteger()

/** The id of the box this semantics node paints, so the export can follow the real tree (a box's ancestors) and not only the geometry. */
const val PARITY_BOX_KEY_NAME = "ParityBox"

/** One key object per box, because peers on one node keep only the first value of a shared key; the export lists the entries named [PARITY_BOX_KEY_NAME]. */
internal fun newParityBoxKey() = androidx.compose.ui.semantics.SemanticsPropertyKey<Int>(PARITY_BOX_KEY_NAME) { parent, _ -> parent }

/** True inside an image slot that shows its placeholder instead of a picture, so the slot is exported as what it draws. */
val LocalParityImagePlaceholder = androidx.compose.runtime.compositionLocalOf { false }

/** Debug parity captures only: ids of boxes whose paint (and subtree) is skipped while the capture script screenshots the screen without them (docs/parity/LAYOUT.md, rendered occlusion check). Read in draw scope, so a change redraws. */
val parityHiddenBoxes = androidx.compose.runtime.mutableStateOf<Set<Int>>(emptySet())

private fun Modifier.hideWhenAsked(box: ParityBox): Modifier = drawWithContent { if (box.id !in parityHiddenBoxes.value) drawContent() }

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
        // An image slot whose picture is not there (artwork placeholder) paints a container, not an image.
        val kind = if (kind == "image" && LocalParityImagePlaceholder.current) "container" else kind
        val box = remember { ParityBox(view, kind, radius, opacity, fillAlpha) }
        box.density = androidx.compose.ui.platform.LocalDensity.current.density; box.kind = kind; box.radius = radius; box.opacity = opacity; box.fillAlpha = fillAlpha
        DisposableEffect(box) { parityBoxes.add(box); onDispose { box.coordinates = null; parityBoxes.remove(box) } }
        onGloballyPositioned { box.coordinates = it }.semantics { this[box.semanticsKey] = box.id }.hideWhenAsked(box)
    }

/**
 * [parityBox] plus the background itself: draws `color` in `shape` and records, in the draw call, the colour it painted (alpha included),
 * so the export reads the app's own paint and not a copy of it.
 */
fun Modifier.parityBackground(kind: String, color: androidx.compose.ui.graphics.Color, shape: androidx.compose.ui.graphics.Shape = androidx.compose.ui.graphics.RectangleShape, radius: Float = 0f, opacity: Float = 1f, drawsBorder: Boolean = false): Modifier =
    parityPaint(kind, color, shape, radius, opacity, drawsBorder).foundationBackground(color, shape)

/**
 * Records, without painting, the fill and the resolved outline a surface draws with (kind `fill` is a backdrop for its descendants and not an
 * element of its own). Placed on the same node as the paint, so the export follows the real tree and reads the shape the app really drew.
 */
fun Modifier.parityPaint(kind: String, color: androidx.compose.ui.graphics.Color, shape: androidx.compose.ui.graphics.Shape, radius: Float = 0f, opacity: Float = 1f, drawsBorder: Boolean = false): Modifier =
    if (!parityLayoutEnabled) this else composed {
        val view = androidx.compose.ui.platform.LocalView.current
        val box = remember { ParityBox(view, kind, radius, opacity, color.alpha) }
        box.density = androidx.compose.ui.platform.LocalDensity.current.density; box.kind = kind; box.radius = radius; box.opacity = opacity; box.fillAlpha = color.alpha
        DisposableEffect(box) { parityBoxes.add(box); onDispose { box.coordinates = null; parityBoxes.remove(box) } }
        this.onGloballyPositioned { box.coordinates = it }.semantics { this[box.semanticsKey] = box.id }.drawBehind {
            box.fill = color
            // A box whose own modifiers also draw a border (set by the caller that draws it) is painted even with a transparent fill.
            box.brushPainted = drawsBorder
            box.drawnRadiusPx = when (val o = shape.createOutline(size, layoutDirection, this)) {
                is androidx.compose.ui.graphics.Outline.Rounded -> o.roundRect.topLeftCornerRadius.x
                is androidx.compose.ui.graphics.Outline.Rectangle -> 0f
                else -> null
            }
        }.hideWhenAsked(box)
    }

/** Foundation's brush background, recorded: a gradient panel is a painted container even though it has no single colour. */
fun Modifier.background(brush: androidx.compose.ui.graphics.Brush, shape: androidx.compose.ui.graphics.Shape = androidx.compose.ui.graphics.RectangleShape, alpha: Float = 1f): Modifier =
    (if (!parityLayoutEnabled) this else composed {
        val view = androidx.compose.ui.platform.LocalView.current
        val box = remember { ParityBox(view, "fill", 0f, 1f, alpha) }
        box.density = androidx.compose.ui.platform.LocalDensity.current.density; box.fillAlpha = alpha
        DisposableEffect(box) { parityBoxes.add(box); onDispose { box.coordinates = null; parityBoxes.remove(box) } }
        this.onGloballyPositioned { box.coordinates = it }.semantics { this[box.semanticsKey] = box.id }.drawBehind {
            box.brushPainted = true
            box.drawnRadiusPx = when (val o = shape.createOutline(size, layoutDirection, this)) {
                is androidx.compose.ui.graphics.Outline.Rounded -> o.roundRect.topLeftCornerRadius.x
                is androidx.compose.ui.graphics.Outline.Rectangle -> 0f
                else -> null
            }
        }.hideWhenAsked(box)
    }).foundationBackground(brush, shape, alpha)

/**
 * Records, without painting, that this node paints a brush (a gradient plate the composable draws itself): the box is a painted container with no single
 * colour, and its resolved outline is the shape's, so the export keeps the gradient as a gradient and never as one flat colour.
 */
fun Modifier.parityBrushPainted(kind: String, shape: androidx.compose.ui.graphics.Shape, radius: Float = 0f, opacity: Float = 1f): Modifier =
    if (!parityLayoutEnabled) this else composed {
        val view = androidx.compose.ui.platform.LocalView.current
        val box = remember { ParityBox(view, kind, radius, opacity, 1f) }
        box.density = androidx.compose.ui.platform.LocalDensity.current.density; box.kind = kind; box.radius = radius; box.opacity = opacity
        DisposableEffect(box) { parityBoxes.add(box); onDispose { box.coordinates = null; parityBoxes.remove(box) } }
        this.onGloballyPositioned { box.coordinates = it }.semantics { this[box.semanticsKey] = box.id }.drawBehind {
            box.brushPainted = true
            box.drawnRadiusPx = when (val o = shape.createOutline(size, layoutDirection, this)) {
                is androidx.compose.ui.graphics.Outline.Rounded -> o.roundRect.topLeftCornerRadius.x
                is androidx.compose.ui.graphics.Outline.Rectangle -> 0f
                else -> null
            }
        }.hideWhenAsked(box)
    }

/** Foundation's background, recorded: drop-in for `androidx.compose.foundation.background(color, shape)` so every solid fill the app paints is read at paint time. */
fun Modifier.background(color: androidx.compose.ui.graphics.Color, shape: androidx.compose.ui.graphics.Shape = androidx.compose.ui.graphics.RectangleShape): Modifier =
    parityPaint("fill", color, shape).foundationBackground(color, shape)

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
        this.onGloballyPositioned { box.coordinates = it }.semantics { this[box.semanticsKey] = box.id }.drawBehind { box.fill = color }
    }

/**
 * `Modifier.alpha(alpha)` that also records the layer alpha it applies (kind `alpha`, not an element of its own): the export multiplies the alphas of
 * a node's ancestors into its effective opacity, as the browser does.
 */
fun Modifier.layerAlpha(alpha: Float): Modifier =
    this.alpha(alpha).let { m ->
        if (!parityLayoutEnabled || alpha >= 1f) m else m.parityBox("alpha", opacity = alpha)
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
