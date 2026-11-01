package io.playarr.shared.designsystem.page

import androidx.compose.material3.LocalTextStyle
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.LineHeightStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.isSpecified
import kotlin.math.roundToInt

/** Marker for [LocalPlayarrWebTextStyle]: the phone text takes Chromium's line box, derived per size by [Text] below. */
val WebLineBox = LineHeightStyle(LineHeightStyle.Alignment.Center, LineHeightStyle.Trim.None)

/** Nunito Sans hhea ascent and descent (em); the file's typo metrics are the same and USE_TYPO_METRICS is set. */
private const val ASCENT_EM = 1.011f
private const val DESCENT_EM = 0.353f

/**
 * Chromium's inline box: ascent and descent are rounded to whole css px, and the leading above the text is the half leading
 * floored to a whole css px (`CalculateLeadingSpace`, a LayoutUnit floor), the rest goes below. Compose splits the unrounded
 * metrics by a ratio, so this maps Chromium's baseline (css px from the line top) to a [LineHeightStyle.Alignment] ratio.
 * [fontPx] and [linePx] are device px, [density] converts to css px (1 dp = 1 css px).
 */
private fun cssBaselineRatio(fontPx: Float, linePx: Float, density: Float): Float {
    val a = ASCENT_EM * fontPx
    val d = DESCENT_EM * fontPx
    val extra = linePx - (a + d)
    if (kotlin.math.abs(extra) < 0.05f) return 0.5f
    val aCss = (ASCENT_EM * fontPx / density).roundToInt()
    val dCss = (DESCENT_EM * fontPx / density).roundToInt()
    val lineCss = linePx / density
    val baselineCss = kotlin.math.floor((lineCss - (aCss + dCss)) / 2f) + aCss
    return ((baselineCss * density - a) / extra).coerceIn(0f, 1f)
}

@Composable
private fun webStyle(style: TextStyle, fontSize: TextUnit, lineHeight: TextUnit): TextStyle {
    if (style.lineHeightStyle != WebLineBox) return style
    // The tablet is fitted separately (screen by screen), so it keeps the earlier split until its css-px rework.
    if (LocalPlayarrFormFactor.current == PlayarrFormFactor.Tv) return style.copy(lineHeightStyle = LineHeightStyle(LineHeightStyle.Alignment(0.3f), LineHeightStyle.Trim.None))
    val density = LocalDensity.current
    val size = (if (fontSize.isSpecified) fontSize else style.fontSize)
    val line = (if (lineHeight.isSpecified) lineHeight else style.lineHeight)
    if (!size.isSp || !line.isSp) return style
    val ratio = with(density) { cssBaselineRatio(size.toPx(), line.toPx(), density.density) }
    return style.copy(lineHeightStyle = LineHeightStyle(LineHeightStyle.Alignment(ratio), LineHeightStyle.Trim.None))
}

@Composable
fun Text(
    text: String,
    modifier: Modifier = Modifier,
    color: Color = Color.Unspecified,
    fontSize: TextUnit = TextUnit.Unspecified,
    fontStyle: FontStyle? = null,
    fontWeight: FontWeight? = null,
    fontFamily: FontFamily? = null,
    letterSpacing: TextUnit = TextUnit.Unspecified,
    textDecoration: TextDecoration? = null,
    textAlign: TextAlign? = null,
    lineHeight: TextUnit = TextUnit.Unspecified,
    overflow: TextOverflow = TextOverflow.Clip,
    softWrap: Boolean = true,
    maxLines: Int = Int.MAX_VALUE,
    minLines: Int = 1,
    onTextLayout: ((TextLayoutResult) -> Unit)? = null,
    style: TextStyle = LocalTextStyle.current,
) = androidx.compose.material3.Text(
    text = text, modifier = modifier, color = color, fontSize = fontSize, fontStyle = fontStyle, fontWeight = fontWeight, fontFamily = fontFamily, letterSpacing = letterSpacing, textDecoration = textDecoration, textAlign = textAlign, lineHeight = lineHeight, overflow = overflow, softWrap = softWrap, maxLines = maxLines, minLines = minLines, onTextLayout = onTextLayout, style = webStyle(style, fontSize, lineHeight),
)

@Composable
fun Text(
    text: AnnotatedString,
    modifier: Modifier = Modifier,
    color: Color = Color.Unspecified,
    fontSize: TextUnit = TextUnit.Unspecified,
    fontStyle: FontStyle? = null,
    fontWeight: FontWeight? = null,
    fontFamily: FontFamily? = null,
    letterSpacing: TextUnit = TextUnit.Unspecified,
    textDecoration: TextDecoration? = null,
    textAlign: TextAlign? = null,
    lineHeight: TextUnit = TextUnit.Unspecified,
    overflow: TextOverflow = TextOverflow.Clip,
    softWrap: Boolean = true,
    maxLines: Int = Int.MAX_VALUE,
    minLines: Int = 1,
    onTextLayout: (TextLayoutResult) -> Unit = {},
    style: TextStyle = LocalTextStyle.current,
) = androidx.compose.material3.Text(
    text = text, modifier = modifier, color = color, fontSize = fontSize, fontStyle = fontStyle, fontWeight = fontWeight, fontFamily = fontFamily, letterSpacing = letterSpacing, textDecoration = textDecoration, textAlign = textAlign, lineHeight = lineHeight, overflow = overflow, softWrap = softWrap, maxLines = maxLines, minLines = minLines, onTextLayout = onTextLayout, style = webStyle(style, fontSize, lineHeight),
)
