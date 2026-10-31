package io.playarr.mobile.ui

import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.Density

/**
 * The span between two absolute web css positions, in whole device pixels as the browser lands them.
 * A browser rounds each edge once, at its summed css position; Compose rounds every padding, spacer and size
 * on its own, so a chain of fractional-pixel parts drifts a pixel from the web edge. Giving the span between the
 * two summed positions makes the far edge land exactly where the browser puts it.
 */
internal fun Density.webSpan(fromCss: Float, toCss: Float): Dp =
    ((Math.round(toCss * density) - Math.round(fromCss * density)).toFloat() / density).let { Dp(it) }

@Composable
internal fun rememberWebSpan(fromCss: Float, toCss: Float): Dp = with(LocalDensity.current) { webSpan(fromCss, toCss) }

/**
 * A stack laid out at absolute web css positions. The browser snaps each box edge once, from its summed css position
 * (`round(css * dpr)`); Compose adds integer sizes and gaps, so a chain of fractional css parts drifts a device pixel.
 * Child `i` sits [topsCss]`[i]` below this stack's own top, [heightsCss]`[i]` tall, and this stack's top is at
 * [originCss] in the page. Children past the lists stack naturally below the last one after [gapCss].
 */
@Composable
internal fun WebCssLayout(
    originCss: Float,
    topsCss: List<Float>,
    heightsCss: List<Float>,
    gapCss: Float,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    androidx.compose.ui.layout.Layout(content = content, modifier = modifier) { measurables, constraints ->
        val d = density
        val base = Math.round(originCss * d)
        var bottom = 0
        val placed = measurables.mapIndexed { i, m ->
            if (i < topsCss.size) {
                val top = Math.round((originCss + topsCss[i]) * d) - base
                val h = Math.round((originCss + topsCss[i] + heightsCss[i]) * d) - base - top
                val p = m.measure(androidx.compose.ui.unit.Constraints.fixed(constraints.maxWidth, h))
                bottom = top + h
                top to p
            } else {
                val top = bottom + Math.round(gapCss * d)
                val p = m.measure(constraints.copy(minWidth = constraints.maxWidth, minHeight = 0))
                bottom = top + p.height
                top to p
            }
        }
        layout(constraints.maxWidth, bottom) { placed.forEach { (y, p) -> p.placeRelative(0, y) } }
    }
}

/** Web phone `.drawer-body` top in css px: 20 padding, 47.36 header (10.56 kicker, 3.2, 33.6 title), 23.66 gap (2.8 vu), 4 body padding. */
internal const val PHONE_DRAWER_BODY_TOP_CSS = 95.02f
