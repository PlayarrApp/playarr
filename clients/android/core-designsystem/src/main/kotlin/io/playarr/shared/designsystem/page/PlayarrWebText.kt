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

/** True for the single-line phone and tablet text that takes Chromium's inline box (the css content area inside the css line box). */
@Composable
private fun isWebLine(style: TextStyle, fontSize: TextUnit, lineHeight: TextUnit, softWrap: Boolean, maxLines: Int): Boolean {
    if (style.lineHeightStyle != WebLineBox) return false
    if (LocalPlayarrFormFactor.current == PlayarrFormFactor.Tv) return false
    if (softWrap && maxLines != 1) return false
    val size = if (fontSize.isSpecified) fontSize else style.fontSize
    val line = if (lineHeight.isSpecified) lineHeight else style.lineHeight
    return size.isSp && line.isSp
}

@Composable
private fun webStyle(style: TextStyle, fontSize: TextUnit, lineHeight: TextUnit): TextStyle {
    if (style.lineHeightStyle != WebLineBox) return style
    // Television keeps its earlier split.
    if (LocalPlayarrFormFactor.current == PlayarrFormFactor.Tv) return style.copy(lineHeightStyle = LineHeightStyle(LineHeightStyle.Alignment(0.3f), LineHeightStyle.Trim.None))
    val density = LocalDensity.current
    val size = (if (fontSize.isSpecified) fontSize else style.fontSize)
    val line = (if (lineHeight.isSpecified) lineHeight else style.lineHeight)
    if (!size.isSp || !line.isSp) return style
    val ratio = with(density) { cssBaselineRatio(size.toPx(), line.toPx(), density.density) }
    return style.copy(lineHeightStyle = LineHeightStyle(LineHeightStyle.Alignment(ratio), LineHeightStyle.Trim.None))
}

/**
 * Chromium's inline box for one line of text: the content area is the font's ascent and descent each rounded to whole css px
 * (A + D tall, baseline A below its top), and it sits in the css line box (`line-height`) with the half leading floored to a whole css px
 * (`CalculateLeadingSpace`), so it can overflow a shorter line box. The text is laid out as exactly that content area (line height A + D,
 * baseline A) inside a frame as tall as the css line box, so the laid-out line box of the text is the css text rect. The text carries
 * [LineBreak.Simple] as the mark that its line box is the content area.
 */
@Composable
private fun WebLineFrame(
    style: TextStyle, fontSize: TextUnit, lineHeight: TextUnit, modifier: Modifier,
    content: @Composable (TextStyle, TextUnit) -> Unit,
) {
    val density = LocalDensity.current
    val d = density.density
    val size = if (fontSize.isSpecified) fontSize else style.fontSize
    val line = if (lineHeight.isSpecified) lineHeight else style.lineHeight
    val fontPx = with(density) { size.toPx() }
    val linePx = with(density) { line.toPx() }
    val aCss = (ASCENT_EM * fontPx / d).roundToInt()
    val dCss = (DESCENT_EM * fontPx / d).roundToInt()
    val areaCss = aCss + dCss
    val offCss = kotlin.math.floor((linePx / d - areaCss) / 2f)
    val a = ASCENT_EM * fontPx
    // The platform ceils a line height to whole device px; giving it the nearest whole px keeps the box at the width the browser snaps to.
    val areaPx = Math.round(areaCss * d).toFloat()
    val extra = areaPx - (a + DESCENT_EM * fontPx)
    val ratio = if (kotlin.math.abs(extra) < 0.5f) 0.5f else ((aCss * d - a) / extra).coerceIn(0f, 1f)
    val childStyle = style.copy(
        lineHeightStyle = LineHeightStyle(LineHeightStyle.Alignment(ratio), LineHeightStyle.Trim.None),
        lineBreak = androidx.compose.ui.text.style.LineBreak.Simple,
    )
    val childLine = with(density) { areaPx.toSp() }
    androidx.compose.ui.layout.Layout(content = { content(childStyle, childLine) }, modifier = modifier) { measurables, constraints ->
        val p = measurables.first().measure(constraints.copy(minHeight = 0, maxHeight = androidx.compose.ui.unit.Constraints.Infinity))
        val frame = kotlin.math.ceil(linePx).toInt().coerceIn(constraints.minHeight, constraints.maxHeight)
        val y = Math.round(offCss * d)
        val lines = HashMap<androidx.compose.ui.layout.AlignmentLine, Int>()
        val first = p[androidx.compose.ui.layout.FirstBaseline]
        if (first != androidx.compose.ui.layout.AlignmentLine.Unspecified) lines[androidx.compose.ui.layout.FirstBaseline] = y + first
        layout(p.width.coerceIn(constraints.minWidth, constraints.maxWidth), frame, lines) { p.place(0, y) }
    }
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
) {
    if (isWebLine(style, fontSize, lineHeight, softWrap, maxLines)) {
        WebLineFrame(style, fontSize, lineHeight, modifier) { cs, cl ->
            androidx.compose.material3.Text(
    text = text, modifier = Modifier, color = color, fontSize = fontSize, fontStyle = fontStyle, fontWeight = fontWeight, fontFamily = fontFamily, letterSpacing = letterSpacing, textDecoration = textDecoration, textAlign = textAlign, lineHeight = cl, overflow = overflow, softWrap = softWrap, maxLines = maxLines, minLines = minLines, onTextLayout = onTextLayout, style = cs,
            )
        }
    } else androidx.compose.material3.Text(
    text = text, modifier = modifier, color = color, fontSize = fontSize, fontStyle = fontStyle, fontWeight = fontWeight, fontFamily = fontFamily, letterSpacing = letterSpacing, textDecoration = textDecoration, textAlign = textAlign, lineHeight = lineHeight, overflow = overflow, softWrap = softWrap, maxLines = maxLines, minLines = minLines, onTextLayout = onTextLayout, style = webStyle(style, fontSize, lineHeight),
    )
}

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
) {
    if (isWebLine(style, fontSize, lineHeight, softWrap, maxLines)) {
        WebLineFrame(style, fontSize, lineHeight, modifier) { cs, cl ->
            androidx.compose.material3.Text(
    text = text, modifier = Modifier, color = color, fontSize = fontSize, fontStyle = fontStyle, fontWeight = fontWeight, fontFamily = fontFamily, letterSpacing = letterSpacing, textDecoration = textDecoration, textAlign = textAlign, lineHeight = cl, overflow = overflow, softWrap = softWrap, maxLines = maxLines, minLines = minLines, onTextLayout = onTextLayout, style = cs,
            )
        }
    } else androidx.compose.material3.Text(
    text = text, modifier = modifier, color = color, fontSize = fontSize, fontStyle = fontStyle, fontWeight = fontWeight, fontFamily = fontFamily, letterSpacing = letterSpacing, textDecoration = textDecoration, textAlign = textAlign, lineHeight = lineHeight, overflow = overflow, softWrap = softWrap, maxLines = maxLines, minLines = minLines, onTextLayout = onTextLayout, style = webStyle(style, fontSize, lineHeight),
    )
}
