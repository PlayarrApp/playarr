package io.playarr.mobile.ui

import androidx.compose.material3.LocalTextStyle
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.Dp

/**
 * A row of text runs laid out as a browser lays out `display: flex; gap: X` text items: every item is as wide as its exact (fractional)
 * glyph run, the gap is added in float and each item's origin is rounded once. Compose rounds every Text up to a whole pixel, which
 * pushes the second and third item 1 to 2 px right of the web's.
 */
@Composable
internal fun WebInlineRow(
    texts: List<String>,
    gap: Dp,
    style: TextStyle,
    modifier: Modifier = Modifier,
    item: @Composable (String) -> Unit,
) {
    val measurer = rememberTextMeasurer()
    val density = LocalDensity.current
    val resolved = LocalTextStyle.current.merge(style)
    val widths = remember(texts, resolved, density) {
        texts.map { t ->
            val m = measurer.measure(t, resolved, softWrap = false, maxLines = 1)
            val ls = resolved.letterSpacing.takeIf { it.isSp }?.value ?: 0f
            m.getLineRight(0) - m.getLineLeft(0) + ls * density.fontScale * density.density
        }
    }
    val gapPx = with(density) { gap.toPx() }
    Layout(content = { texts.forEach { item(it) } }, modifier = modifier) { measurables, constraints ->
        val placeables = measurables.map { it.measure(Constraints()) }
        var x = 0f
        val xs = widths.indices.map { i -> Math.round(x).also { x += widths[i] + gapPx } }
        val width = (xs.lastOrNull() ?: 0) + (placeables.lastOrNull()?.width ?: 0)
        val height = placeables.maxOfOrNull { it.height } ?: 0
        layout(width.coerceIn(constraints.minWidth, maxOf(constraints.minWidth, constraints.maxWidth)), height) {
            placeables.forEachIndexed { i, p -> p.placeRelative(xs[i], 0) }
        }
    }
}
