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
