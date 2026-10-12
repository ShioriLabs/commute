package id.shiorilabs.commute.feature.station.presentation

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.text.InlineTextContent
import androidx.compose.foundation.text.appendInlineContent
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.Placeholder
import androidx.compose.ui.text.PlaceholderVerticalAlign
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

private const val TRAILING_ICON_ID = "trailing"

/** Joins the icon to the last word, so it never wraps onto a line of its own. */
private const val WORD_JOINER = "⁠"

/**
 * A station's name as it flies between the home feed and the station page's header: both ends draw
 * this same text, so it flies as one piece. The name stands alone, with no "Stasiun" or "Halte"
 * before it, so a long one wraps from the left edge like any other title.
 *
 * The flight lays the text out at the bounds it is passing through, so a name that wraps on one end
 * and not the other breaks where the bounds first allow it. Laying it out unbounded for the flight
 * instead showed it unwrapped from the first frame, then snapped back on landing.
 *
 * @param shared whether the name is a shared element with the other end of the flight.
 * @param scaleWithFlight whether the name scales to the other end in flight, for an end whose
 *   text is a different size (a search row's), rather than flying at its own size.
 * @param trailingIcon drawn inline after the last word, wherever that falls: the web's caret on a
 *   title that opens a page. It is part of the text, so the name's flight carries it along.
 */
@Composable
fun StationTitleText(
    stationId: String,
    name: String,
    style: TextStyle,
    modifier: Modifier = Modifier,
    shared: Boolean = true,
    scaleWithFlight: Boolean = false,
    trailingIcon: ImageVector? = null,
) {
    val text = remember(name, trailingIcon) {
        if (trailingIcon == null) {
            AnnotatedString(name)
        } else {
            buildAnnotatedString {
                append(name)
                append(WORD_JOINER)
                appendInlineContent(TRAILING_ICON_ID, "›")
            }
        }
    }
    val inline = if (trailingIcon == null) {
        emptyMap()
    } else {
        mapOf(
            TRAILING_ICON_ID to InlineTextContent(
                Placeholder(width = 24.sp, height = 16.sp, placeholderVerticalAlign = PlaceholderVerticalAlign.Center),
            ) {
                // 8dp of air before the caret, then the caret itself, 16dp.
                Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.CenterEnd) {
                    Icon(
                        imageVector = trailingIcon,
                        contentDescription = null,
                        modifier = Modifier.size(16.dp),
                        tint = style.color,
                    )
                }
            },
        )
    }
    Text(
        text = text,
        modifier = modifier.sharedStationName(stationId, enabled = shared, scaleText = scaleWithFlight),
        style = style,
        inlineContent = inline,
    )
}
