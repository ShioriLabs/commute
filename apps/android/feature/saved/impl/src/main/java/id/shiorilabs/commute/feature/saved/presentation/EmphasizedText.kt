package id.shiorilabs.commute.feature.saved.presentation

import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight

/**
 * This text with the first occurrence of [part] in bold — how copy points at a control by its
 * label. Returned unstyled when [part] is blank or absent.
 */
internal fun String.withBold(part: String): AnnotatedString {
    val start = if (part.isEmpty()) -1 else indexOf(part)
    if (start < 0) {
        return AnnotatedString(this)
    }
    return buildAnnotatedString {
        append(this@withBold)
        addStyle(SpanStyle(fontWeight = FontWeight.Bold), start, start + part.length)
    }
}
