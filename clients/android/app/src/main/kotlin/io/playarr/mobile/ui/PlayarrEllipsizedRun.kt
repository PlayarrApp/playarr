package io.playarr.mobile.ui

/**
 * What the platform text layout displays for one style run of a line it ellipsized. android.text.Layout keeps the original characters and reports,
 * per line, the span it replaced ([ellipsisStart] and [ellipsisCount], relative to the line start); the drawn line is the characters before that
 * span, the ellipsis, then the characters after it. That holds for end, start and middle truncation alike. The run that holds the first replaced
 * character carries the ellipsis; a run wholly inside the replaced span displays nothing of its own.
 */
internal object PlayarrEllipsizedRun {
    /** Where the ellipsis sits among the characters a run still shows. */
    enum class Side { None, Before, After, Between, Only }

    /** Replaced span of the paragraph text, from the layout's per-line report: [first, endExclusive). */
    data class Span(val first: Int, val endExclusive: Int)

    fun span(lineStart: Int, ellipsisStart: Int, ellipsisCount: Int, paragraphStart: Int): Span =
        Span(paragraphStart + lineStart + ellipsisStart, paragraphStart + lineStart + ellipsisStart + ellipsisCount)

    /** True when the run [runStart, runEnd) holds the ellipsis: it contains the first replaced character. */
    fun holdsEllipsis(runStart: Int, runEnd: Int, span: Span): Boolean = span.endExclusive > span.first && span.first >= runStart && span.first < runEnd

    /** The indices of the run that the layout still draws as themselves (not replaced), in order. */
    fun visibleIndices(runStart: Int, runEnd: Int, span: Span): List<Int> = (runStart until runEnd).filter { it < span.first || it >= span.endExclusive }

    /** The displayed string of the run: the characters it keeps, with [ellipsis] where the replaced span begins when the run holds it. Outer whitespace is dropped. */
    fun displayedText(raw: CharSequence, runStart: Int, runEnd: Int, span: Span, ellipsis: String): String {
        val sb = StringBuilder()
        for (i in runStart until runEnd) {
            if (i >= span.first && i < span.endExclusive) { if (i == span.first) sb.append(ellipsis) } else sb.append(raw[i])
        }
        return sb.toString().trim()
    }

    /** Which side of the run's visible characters the ellipsis is drawn at (logical order). */
    fun side(runStart: Int, runEnd: Int, span: Span): Side {
        if (!holdsEllipsis(runStart, runEnd, span)) return Side.None
        val vis = visibleIndices(runStart, runEnd, span)
        val before = vis.any { it < span.first }
        val after = vis.any { it >= span.endExclusive }
        return when {
            before && after -> Side.Between
            before -> Side.After
            after -> Side.Before
            else -> Side.Only
        }
    }
}
