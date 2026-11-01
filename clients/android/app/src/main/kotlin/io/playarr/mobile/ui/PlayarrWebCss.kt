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

/**
 * A one-line row whose children are as wide as their content, packed against the right edge with a css [gapCss] between them, each
 * [heightCss] tall and centred in the row. Edges are summed in css px and every edge snapped to a device pixel once, as the browser does;
 * a Compose row would round each child width and gap on its own and drift a pixel from the web edges.
 */
@Composable
internal fun WebCssEndRow(gapCss: Float, heightCss: Float, modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    androidx.compose.ui.layout.Layout(content = content, modifier = modifier) { measurables, constraints ->
        val d = density
        val widthsCss = measurables.map { it.maxIntrinsicWidth(Math.round(heightCss * d)) / d }
        val rowH = Math.round(heightCss * d)
        var right = constraints.maxWidth / d
        val placed = ArrayList<Pair<Int, androidx.compose.ui.layout.Placeable>>()
        for (i in measurables.indices.reversed()) {
            val l = right - widthsCss[i]
            val x0 = Math.round(l * d)
            val x1 = Math.round(right * d)
            placed.add(0, x0 to measurables[i].measure(androidx.compose.ui.unit.Constraints.fixed(x1 - x0, rowH)))
            right = l - gapCss
        }
        layout(constraints.maxWidth, rowH) { placed.forEach { (x, p) -> p.placeRelative(x, 0) } }
    }
}

/**
 * A row of fixed css-width children laid out at absolute web css positions: child `i` starts at [startCss] plus the widths
 * and [gapCss] gaps before it, each edge snapped to a device pixel once, as the browser does. The row is [startCss] +
 * widths + gaps + [endCss] wide, so it also works inside a horizontal scroller.
 */
@Composable
internal fun WebCssRow(
    startCss: Float,
    endCss: Float,
    widthsCss: List<Float>,
    gapCss: Float,
    modifier: Modifier = Modifier,
    originCss: Float = 0f,
    content: @Composable () -> Unit,
) {
    androidx.compose.ui.layout.Layout(content = content, modifier = modifier) { measurables, constraints ->
        val d = density
        val base = Math.round(originCss * d)
        var x = startCss
        var maxH = 0
        val placed = measurables.mapIndexed { i, m ->
            val w = widthsCss[minOf(i, widthsCss.size - 1)]
            val x0 = Math.round((originCss + x) * d) - base
            val x1 = Math.round((originCss + x + w) * d) - base
            x += w + gapCss
            val p = m.measure(androidx.compose.ui.unit.Constraints(minWidth = x1 - x0, maxWidth = x1 - x0, minHeight = 0, maxHeight = constraints.maxHeight))
            maxH = maxOf(maxH, p.height)
            x0 to p
        }
        val total = Math.round((originCss + x - gapCss + endCss) * d) - base
        layout(total, maxH) { placed.forEach { (px, p) -> p.placeRelative(px, 0) } }
    }
}

/**
 * Blink's LayoutUnit: layout lengths are fixed point with 6 fractional bits (1/64 css px). A css length enters layout by truncating
 * to that grid (`0.4rem` = 6.4 is laid out as 6.390625), and every sum, share and position after that is an exact multiple of 1/64.
 */
internal fun webLayoutUnit(css: Float): Float = Math.floor((css * 64f).toDouble()).toFloat() / 64f

/** Css `clamp(min, preferred, max)` in px, entering layout as a LayoutUnit. */
internal fun webClamp(minCss: Float, preferredCss: Float, maxCss: Float): Float = webLayoutUnit(preferredCss.coerceIn(minCss, maxCss))

/**
 * A grid's `1fr` tracks as the browser sizes them: the free space ([availableCss], already a LayoutUnit sum) divided over [count]
 * equal flexible tracks, each share truncated to the LayoutUnit grid (the remainder stays unallocated, as in Blink's grid track sizing).
 * Tracks with a `minmax(0, 1fr)` minimum take the same share.
 */
internal fun webFrTracks(availableCss: Float, count: Int): List<Float> {
    if (count <= 0) return emptyList()
    val each = webLayoutUnit(webLayoutUnit(availableCss) / count)
    return List(count) { each }
}

/** The track edges in css px: [originCss] plus the running sum of [sizesCss], every value an exact LayoutUnit sum (count + 1 edges). */
internal fun webTrackEdges(originCss: Float, sizesCss: List<Float>): List<Float> {
    val edges = ArrayList<Float>(sizesCss.size + 1)
    var at = webLayoutUnit(originCss)
    edges += at
    for (s in sizesCss) { at += webLayoutUnit(s); edges += at }
    return edges
}

/** Device pixel of a css edge, rounded once from its summed position (the browser's pixel snapping). */
internal fun Density.webSnap(css: Float): Int = Math.round(css * density)

/** Phone month grid (css `.calendar-month`) laid out from its CSS: the geometry [webPhoneMonth] resolves. */
internal class WebPhoneMonth(
    /** Header (weekday strip) height in css px: top padding 0.4rem + one 1.5 line of 0.75rem + bottom padding 0.4rem. */
    val headerCss: Float,
    /** The weekday label's top padding, 0.4rem as a LayoutUnit. */
    val weekdayPadCss: Float,
    /** Weekday line height, 1.5 * 0.75rem. */
    val weekdayLineCss: Float,
    /** The seven `1fr` column edges from the grid's left edge (8 values, css px relative to the grid). */
    val columnEdgesCss: List<Float>,
    /** The week row edges from the grid body's top (weeks + 1 values, css px relative to the body). */
    val rowEdgesCss: List<Float>,
)

/**
 * Resolves the phone calendar month from the css in `Calendar.css` / `page-layout.css`:
 * `.calendar-month { min-width: 720px; display: flex; column }`, `.calendar-month-head/-row { grid-template-columns: repeat(7, minmax(0, 1fr)) }`,
 * `.calendar-month-weekday { padding: .4rem; font-size: .75rem }` (line-height 1.5 from global.css), `.calendar-month-body { flex: 1 1 auto; display: grid;
 * grid-template-rows: repeat(weeks, minmax(0, 1fr)) }`. [monthTopCss] is the month box's top (below the toolbar and its 0.75rem gap), [viewportHeightCss]
 * the viewport height: the page keeps `padding-bottom: clamp(92px, 11vh, 124px)` (`--page-safe-bottom`), the body takes what is left.
 */
internal fun webPhoneMonth(monthTopCss: Float, viewportHeightCss: Float, weeks: Int, remPx: Float = 16f): WebPhoneMonth {
    val pad = webLayoutUnit(0.4f * remPx)
    val line = webLayoutUnit(1.5f * 0.75f * remPx)
    val header = pad + line + pad
    val bottomPad = webClamp(92f, 11f * viewportHeightCss / 100f, 124f)
    val body = webLayoutUnit(viewportHeightCss) - bottomPad - (webLayoutUnit(monthTopCss) + header)
    val columns = webTrackEdges(0f, webFrTracks(720f, 7))
    val rows = webTrackEdges(0f, webFrTracks(body, weeks))
    return WebPhoneMonth(header, pad, line, columns, rows)
}
