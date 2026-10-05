package id.shiorilabs.commute.feature.trip.presentation

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.TextDecoration
import id.shiorilabs.commute.feature.trip.R
import java.time.Instant
import kotlin.math.abs

/**
 * A stop's time, honest about the timetable, as a TR board says "18:00 Delay 5 min": when [actual]
 * (seen, or expected with lateness) falls on another minute than [scheduled], the timetable's
 * struck through over it, and how far off beside it ("09.55 +5"). On the minute, just the time.
 */
@Composable
internal fun TimetableTime(
    scheduled: Instant?,
    actual: Instant?,
    style: TextStyle,
    color: Color,
    struck: Color,
    late: Color,
    early: Color,
    modifier: Modifier = Modifier,
) {
    val shown = actual ?: scheduled ?: return
    val off = if (scheduled != null && actual != null) minutesOff(scheduled, actual) else 0
    if (off == 0) {
        Text(text = formatClock(shown), modifier = modifier, style = style, color = color)
        return
    }
    val description = stringResource(
        if (off > 0) R.string.trip_time_late else R.string.trip_time_early,
        formatClock(shown),
        abs(off),
        formatClock(scheduled!!),
    )
    Column(
        modifier = modifier.clearAndSetSemantics { contentDescription = description },
        horizontalAlignment = Alignment.End,
    ) {
        Text(text = formatClock(scheduled), style = style, color = struck, textDecoration = TextDecoration.LineThrough)
        Row {
            Text(text = formatClock(shown), modifier = Modifier.alignByBaseline(), style = style, color = color)
            Text(
                text = if (off > 0) " +$off" else " −${-off}",
                modifier = Modifier.alignByBaseline(),
                style = style,
                color = if (off > 0) late else early,
            )
        }
    }
}

/** How many minutes [actual] falls after [scheduled] as their clocks read: the "+5" beside "09.55". */
internal fun minutesOff(scheduled: Instant, actual: Instant): Int =
    (Math.floorDiv(actual.epochSecond, 60L) - Math.floorDiv(scheduled.epochSecond, 60L)).toInt()
