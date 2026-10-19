package io.playarr.mobile.ui

/**
 * Web `text-wrap: balance` for a title capped at [maxWidth]: a title that does not fit on one line is split at the word
 * boundary where the longer line is shortest. [width] measures a string in the same unit as [maxWidth].
 * shortcut: two lines only (the phone title clamps to two), a one-word title is returned unchanged.
 */
internal fun balanceTitleWrap(title: String, maxWidth: Int, width: (String) -> Int): String {
    val words = title.split(' ')
    if (words.size < 2 || width(title) <= maxWidth) return title
    val split = (1 until words.size).minBy {
        maxOf(width(words.take(it).joinToString(" ")), width(words.drop(it).joinToString(" ")))
    }
    return words.take(split).joinToString(" ") + "\n" + words.drop(split).joinToString(" ")
}
