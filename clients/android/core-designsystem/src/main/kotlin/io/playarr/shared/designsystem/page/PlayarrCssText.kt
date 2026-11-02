package io.playarr.shared.designsystem.page

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.FirstBaseline
import androidx.compose.ui.layout.LastBaseline
import androidx.compose.ui.layout.layout
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontSynthesis
import androidx.compose.ui.text.font.FontWeight
import kotlin.math.floor
import kotlin.math.roundToInt

/**
 * CSS inline layout for a text, as a browser lays it out (CSS Inline 3, Blink LayoutNG): the font's ascent and descent are each rounded to a whole CSS px
 * (the inline box's content area is `round(ascent) + round(descent)` tall), and the line's leading is split with the half above floored to a whole px, so the
 * baseline sits `floor((line-height - content) / 2) + round(ascent)` below the line top. Compose's own leading split works on the unrounded metrics, so a
 * television text is moved vertically (its layout, not only what is reported) until its first baseline is where the browser puts it.
 */
internal fun cssBaselineOffset(lineHeight: Float, ascent: Float, descent: Float): Float {
    val ra = Math.round(ascent).toFloat(); val rd = Math.round(descent).toFloat()
    return floor((lineHeight - (ra + rd)) / 2f) + ra
}

/** The ascent and descent (css px) a browser takes from a font at [sizePx]: the font's own, each rounded to a whole px. */
internal fun cssFontExtent(typeface: android.graphics.Typeface, sizePx: Float): Pair<Float, Float> {
    val paint = android.graphics.Paint().apply { this.typeface = typeface; textSize = sizePx; isAntiAlias = true }
    val fm = paint.fontMetrics
    return -fm.ascent to fm.descent
}

@Composable
internal fun Modifier.cssText(style: TextStyle): Modifier {
    if (LocalPlayarrFormFactor.current != PlayarrFormFactor.Tv) return this
    val density = LocalDensity.current
    val resolver = androidx.compose.ui.platform.LocalFontFamilyResolver.current
    val size = style.fontSize
    if (!size.isSp) return this
    val typeface = remember(style.fontFamily, style.fontWeight, style.fontStyle, resolver) {
        resolver.resolve(style.fontFamily, style.fontWeight ?: FontWeight.Normal, style.fontStyle ?: FontStyle.Normal, style.fontSynthesis ?: FontSynthesis.All).value as? android.graphics.Typeface
    } ?: return this
    val sizePx = with(density) { size.toPx() }
    val extent = remember(typeface, sizePx) { cssFontExtent(typeface, sizePx) }
    val lh = style.lineHeight
    val lineHeightPx = when {
        lh.isSp -> with(density) { lh.toPx() }
        lh.isEm -> lh.value * sizePx
        else -> Math.round(extent.first) + Math.round(extent.second).toFloat()
    }
    val unit = density.density
    val target = cssBaselineOffset(lineHeightPx / unit, extent.first / unit, extent.second / unit) * unit
    return this.layout { measurable, constraints ->
        val placeable = measurable.measure(constraints)
        val first = placeable[FirstBaseline]
        if (first == androidx.compose.ui.layout.AlignmentLine.Unspecified) {
            layout(placeable.width, placeable.height) { placeable.place(0, 0) }
        } else {
            val dy = (target - first).roundToInt()
            val last = placeable[LastBaseline]
            val lines = buildMap<androidx.compose.ui.layout.AlignmentLine, Int> {
                put(FirstBaseline, first + dy)
                if (last != androidx.compose.ui.layout.AlignmentLine.Unspecified) put(LastBaseline, last + dy)
            }
            layout(placeable.width, placeable.height, lines) { placeable.place(0, dy) }
        }
    }
}
