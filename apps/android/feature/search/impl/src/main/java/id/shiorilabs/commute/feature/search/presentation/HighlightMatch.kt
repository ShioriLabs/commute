package id.shiorilabs.commute.feature.search.presentation

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString

/**
 * This text with the first case-insensitive occurrence of [query] in [color], as the web's
 * `HighlightMatch` does. A result that matched only by a typo has no such occurrence and renders
 * plain.
 */
internal fun String.highlightMatch(query: String, color: Color): AnnotatedString {
    val start = if (query.isEmpty()) -1 else indexOf(query, ignoreCase = true)
    if (start < 0) {
        return AnnotatedString(this)
    }
    return buildAnnotatedString {
        append(this@highlightMatch)
        addStyle(SpanStyle(color = color), start, start + query.length)
    }
}
