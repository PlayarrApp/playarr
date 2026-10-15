package io.playarr.shared.designsystem.page

import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyGridScope
import androidx.compose.foundation.lazy.grid.LazyGridState
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.RoundRect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.semantics.SemanticsPropertyKey
import androidx.compose.ui.semantics.SemanticsPropertyReceiver
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.playarr.shared.designsystem.theme.PlayarrWebPalette
import io.playarr.shared.designsystem.theme.PlayarrWebTheme

/** Which edges of a scroll viewport have content beyond them, and so show the fade. */
data class PlayarrScrollEdges(val top: Boolean = false, val bottom: Boolean = false, val start: Boolean = false, val end: Boolean = false) {
    override fun toString(): String = listOfNotNull(
        "top".takeIf { top }, "bottom".takeIf { bottom }, "start".takeIf { start }, "end".takeIf { end },
    ).joinToString(",")

    companion object {
        fun of(canScrollBackward: Boolean, canScrollForward: Boolean, axis: Orientation) =
            if (axis == Orientation.Vertical) PlayarrScrollEdges(top = canScrollBackward, bottom = canScrollForward)
            else PlayarrScrollEdges(start = canScrollBackward, end = canScrollForward)
    }
}

/** Semantics: the edges currently faded. For tests. */
val PlayarrScrollEdgesKey = SemanticsPropertyKey<PlayarrScrollEdges>("PlayarrScrollEdges")
internal var SemanticsPropertyReceiver.scrollEdges by PlayarrScrollEdgesKey

/**
 * The one edge fade (owner rule: every scrollable area, both themes), web's `[data-fade-axis]` mask: content alpha from a 0.3 floor at the
 * edge to 1 over clamp(38, 5.5 vu, 64) with eased stops, on every faded edge in both themes. One viewport unit is 1% of the screen height.
 *
 * Apply it to the viewport, outside the scrolling modifier. The edges are also published in semantics.
 */
@Composable
fun Modifier.playarrEdgeFades(canScrollBackward: Boolean, canScrollForward: Boolean, axis: Orientation): Modifier =
    playarrEdgeFades(PlayarrScrollEdges.of(canScrollBackward, canScrollForward, axis))

@Composable
internal fun Modifier.playarrEdgeFades(edges: PlayarrScrollEdges): Modifier {
    val config = LocalConfiguration.current
    val dark = PlayarrWebTheme.palette.dark
    // Web `--page-edge-fade-size`: clamp(38px, 5.5 vu, 64px) on every edge and both axes, one viewport unit being 1% of the height.
    val band = (5.5f * config.screenHeightDp / 100f).coerceIn(38f, 64f).dp
    return this
        .semantics { scrollEdges = edges }
        .drawWithContent {
            drawContent()
            drawRampFades(edges, if (dark) PanelDark else PanelLight, band.toPx())
        }
}

/** The panel colour the web mask reveals behind a faded edge (measured under the Movies grid at 1920 x 1080). */
private val PanelDark = Color(0xFF262125)
private val PanelLight = Color(0xFFF2F1F1)

/**
 * Web `[data-fade-axis]` mask: content alpha rises from the 0.3 floor at the edge to 1 over the band along smoothstep stops
 * (0.156, 0.5, 0.844 at 25, 50 and 75%); drawn as the panel colour at the complementary alpha.
 */
private fun DrawScope.drawRampFades(edges: PlayarrScrollEdges, panel: Color, band: Float) {
    val floor = PlayarrEdgeFadeTokens.MaskFloor
    fun ramp(from: Offset, to: Offset) = Brush.linearGradient(
        0f to panel.copy(alpha = 1f - floor),
        0.25f to panel.copy(alpha = 1f - (floor + (1f - floor) * 0.156f)),
        0.5f to panel.copy(alpha = 1f - (floor + (1f - floor) * 0.5f)),
        0.75f to panel.copy(alpha = 1f - (floor + (1f - floor) * 0.844f)),
        1f to Color.Transparent,
        start = from, end = to,
    )
    val b = band.coerceAtMost(minOf(size.width, size.height))
    if (edges.top) drawRect(ramp(Offset(0f, 0f), Offset(0f, b)), Offset.Zero, Size(size.width, b))
    if (edges.bottom) drawRect(ramp(Offset(0f, size.height), Offset(0f, size.height - b)), Offset(0f, size.height - b), Size(size.width, b))
    if (edges.start) drawRect(ramp(Offset(0f, 0f), Offset(b, 0f)), Offset.Zero, Size(b, size.height))
    if (edges.end) drawRect(ramp(Offset(size.width, 0f), Offset(size.width - b, 0f)), Offset(size.width - b, 0f), Size(b, size.height))
}

/** A vertical lazy list whose viewport shows the edge fades. */
@Composable
fun PlayarrScrollColumn(
    state: LazyListState,
    scrollKey: String,
    contentPadding: PaddingValues = PaddingValues(0.dp),
    verticalArrangement: Arrangement.Vertical = Arrangement.Top,
    content: LazyListScope.() -> Unit,
) {
    LazyColumn(
        state = state,
        contentPadding = contentPadding,
        verticalArrangement = verticalArrangement,
        modifier = Modifier.fillMaxSize().playarrEdgeFades(state.canScrollBackward, state.canScrollForward, Orientation.Vertical),
        content = content,
    )
}

/** A lazy grid whose viewport shows the edge fades. */
@Composable
fun PlayarrScrollGrid(
    state: LazyGridState,
    columns: GridCells,
    scrollKey: String,
    contentPadding: PaddingValues = PaddingValues(0.dp),
    verticalArrangement: Arrangement.Vertical = Arrangement.Top,
    horizontalArrangement: Arrangement.Horizontal = Arrangement.Start,
    content: LazyGridScope.() -> Unit,
) {
    LazyVerticalGrid(
        columns = columns,
        state = state,
        contentPadding = contentPadding,
        verticalArrangement = verticalArrangement,
        horizontalArrangement = horizontalArrangement,
        modifier = Modifier.fillMaxSize().playarrEdgeFades(state.canScrollBackward, state.canScrollForward, Orientation.Vertical),
        content = content,
    )
}

/** A horizontal lazy row whose viewport shows the edge fades. */
@Composable
fun PlayarrScrollRow(
    state: LazyListState,
    scrollKey: String,
    contentPadding: PaddingValues = PaddingValues(0.dp),
    horizontalArrangement: Arrangement.Horizontal = Arrangement.Start,
    content: LazyListScope.() -> Unit,
) {
    LazyRow(
        state = state,
        contentPadding = contentPadding,
        horizontalArrangement = horizontalArrangement,
        modifier = Modifier.fillMaxSize().playarrEdgeFades(state.canScrollBackward, state.canScrollForward, Orientation.Horizontal),
        content = content,
    )
}
