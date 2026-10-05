package id.shiorilabs.commute.feature.trip.presentation

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import id.shiorilabs.commute.feature.trip.R
import java.time.Instant

/** What the rider saw the train do, for the log. */
enum class MarkKind(val key: String, val label: Int, val fill: Color, val ink: Color) {
    /** The train started moving. */
    MOVING("moving", R.string.trip_mark_moving, Color(0xFF059669), Color.White),

    /** The train stopped at a station. */
    STOPPED("stopped", R.string.trip_mark_stopped, Color(0xFF0F172A), Color.White),

    /** What the page says is wrong right now. */
    ODD("odd", R.string.trip_mark_odd, Color(0xFFF59E0B), Color(0xFF0F172A)),
}

/** The bar's height above the bottom inset, which the page keeps clear under its last row. */
internal val MarkBarHeight: Dp = 100.dp

/**
 * "Tandai manual": three big buttons under the trip page, pressed when the train moves off, when it
 * stops, and when the page is wrong. Each tap is logged beside what the trip made of it; nothing
 * about the trip changes. A tap answers with a buzz, so it can be made without looking.
 */
@Composable
internal fun MarkBar(bottomInset: Dp, onMark: (MarkKind) -> Unit, modifier: Modifier = Modifier) {
    val haptics = LocalHapticFeedback.current
    var last by remember { mutableStateOf<Pair<MarkKind, Instant>?>(null) }
    Column(
        modifier = modifier
            .fillMaxWidth()
            .background(Color.White)
            .padding(bottom = bottomInset),
    ) {
        Box(modifier = Modifier.fillMaxWidth().height(1.dp).background(Color(0xFFE2E8F0)))
        Text(
            text = last?.let { (kind, at) -> stringResource(R.string.trip_mark_last, stringResource(kind.label), formatClockSeconds(at)) }
                ?: stringResource(R.string.trip_mark_hint),
            modifier = Modifier.padding(start = 16.dp, top = 8.dp, end = 16.dp),
            style = MaterialTheme.typography.labelMedium,
            color = Color(0xFF64748B),
        )
        Row(
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            MarkKind.entries.forEach { kind ->
                Box(
                    modifier = Modifier
                        .weight(1f)
                        .height(52.dp)
                        .clip(RoundedCornerShape(12.dp))
                        .background(kind.fill)
                        .clickable(role = Role.Button) {
                            haptics.performHapticFeedback(HapticFeedbackType.Confirm)
                            last = kind to Instant.now()
                            onMark(kind)
                        },
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        text = stringResource(kind.label),
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold,
                        color = kind.ink,
                    )
                }
            }
        }
    }
}
