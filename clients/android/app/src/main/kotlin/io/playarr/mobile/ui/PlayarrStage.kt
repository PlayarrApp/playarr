package io.playarr.mobile.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/** Scale of the 1920 px web canvas on screen: 1 on television, the screen width over 1920 on a tablet (see PlayarrApp). */
internal val LocalStageScale = compositionLocalOf { 1f }

/**
 * A web `clamp(min px, percent * vh, max px)` token in stage dp. Web's vertical tokens follow the viewport height while
 * the stage scales by width, so a tablet (1280 x 800) needs the real clamp, not the 1080 value scaled.
 */
@Composable
internal fun webVu(minCss: Float, percent: Float, maxCss: Float): Dp {
    val scale = LocalStageScale.current
    val viewportHeightCss = LocalConfiguration.current.screenHeightDp * scale
    return ((percent * viewportHeightCss / 100f).coerceIn(minCss, maxCss) / scale).dp
}

/** Web MultiSelect list cap: `min(260px, 34vh)`, converted back to stage dp. */
internal fun webMultiSelectMaxHeight(viewportHeightCss: Float, stageScale: Float): Dp =
    (minOf(260f, viewportHeightCss * 0.34f) / stageScale).dp

/** Top of the hero copy beside a library or detail page: web's 24 vu, which is 259 dp at 1080 and 192 css px at 800. */
@Composable
internal fun tvHeroTop(): Dp = if (LocalStageScale.current == 1f) 259.dp else webVu(0f, 24f, Float.MAX_VALUE)

/** A web `clamp(min px, percent * vw, max px)` token in stage dp (the counterpart of [webVu] for widths). */
@Composable
internal fun webVw(minCss: Float, percent: Float, maxCss: Float): Dp {
    val scale = LocalStageScale.current
    val viewportWidthCss = LocalConfiguration.current.screenWidthDp * scale
    return ((percent * viewportWidthCss / 100f).coerceIn(minCss, maxCss) / scale).dp
}

/**
 * Web's library grid rail (`--card-w`, `--library-rail-left/right`, `--card-grid-gap`) for the viewport: the rail is 62%
 * of the width (66% at 1100 px or less), minus its paddings, split into `cols` columns. Television keeps the 1920 values.
 */
internal class WebLibraryRail(val start: Dp, val end: Dp, val gap: Dp, val coverGap: Dp, private val railPercent: Float, private val scale: Float, private val widthCss: Float) {
    fun cardWidth(cols: Int, cover: Boolean): Dp {
        val gapCss = (if (cover) coverGap else gap).value * scale
        val css = (railPercent * widthCss / 100f) - start.value * scale - end.value * scale - (cols - 1) * gapCss
        return (css / cols / scale).dp
    }
}

@Composable
internal fun webLibraryRail(): WebLibraryRail {
    val scale = LocalStageScale.current
    val configuration = LocalConfiguration.current
    val widthCss = configuration.screenWidthDp * scale
    val heightCss = configuration.screenHeightDp * scale
    val edge = webVw(5f, 0.65f, 14f)
    val end = edge + maxOf(webVw(48f, 3.6f, 62f), (56f / scale).dp) + webVw(18f, 1.5f, 30f)
    return WebLibraryRail(
        start = webVw(28f, 2.8f, 54f), end = end, gap = webVw(14f, 1.35f, 28f), coverGap = webVw(12f, 1f, 20f),
        railPercent = if (widthCss <= 1100f || heightCss <= 700f) 66f else 62f, scale = scale, widthCss = widthCss,
    )
}

/**
 * Draws [content] at the device's own density instead of the 1920 px stage. Web's player chrome is css px at the real
 * viewport (not a width fraction), so on a tablet it is 1 / stage scale larger than the stage would draw it (1 on television).
 * [densityIsReal]: a Dialog window already composes at the device's own density, so only the stage scale and configuration reset.
 */
@Composable
internal fun UnstagedForWebCssPx(densityIsReal: Boolean = false, content: @Composable () -> Unit) {
    val scale = LocalStageScale.current
    if (scale == 1f) { content(); return }
    val density = androidx.compose.ui.platform.LocalDensity.current
    val config = LocalConfiguration.current
    val real = if (densityIsReal) config else android.content.res.Configuration(config).apply {
        screenWidthDp = (config.screenWidthDp * scale).toInt()
        screenHeightDp = (config.screenHeightDp * scale).toInt()
    }
    androidx.compose.runtime.CompositionLocalProvider(
        androidx.compose.ui.platform.LocalDensity provides (if (densityIsReal) density else androidx.compose.ui.unit.Density(density.density / scale, density.fontScale)),
        LocalConfiguration provides real,
        LocalStageScale provides 1f,
        content = content,
    )
}
