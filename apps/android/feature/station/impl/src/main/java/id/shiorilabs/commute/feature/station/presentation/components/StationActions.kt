package id.shiorilabs.commute.feature.station.presentation.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.scale
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import id.shiorilabs.commute.core.ui.components.CommuteButton
import id.shiorilabs.commute.core.ui.components.CommuteButtonIcon
import id.shiorilabs.commute.core.ui.components.CommuteButtonText
import id.shiorilabs.commute.core.ui.components.CommuteButtonVariant
import id.shiorilabs.commute.core.ui.icons.CommuteIcons
import id.shiorilabs.commute.core.ui.preview.CommutePreviewScaffold
import id.shiorilabs.commute.feature.station.R

/**
 * The buttons over the departures, as on the web: "OTW Ke Sini" to plan a trip here, and "Jadwal
 * Lengkap" for the full day's timetable. Without [onOpenTimetable] (TransJakarta, which publishes
 * none) the OTW button stands alone: a missing schedule is a fact about the operator, not a reason
 * to withhold trip planning.
 */
@Composable
fun StationActions(
    onOtw: () -> Unit,
    modifier: Modifier = Modifier,
    onOpenTimetable: (() -> Unit)? = null,
) {
    // As tall as each other: the OTW button's icon would otherwise make it the taller one.
    Row(
        modifier = modifier
            .fillMaxWidth()
            .height(IntrinsicSize.Min),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        CommuteButton(onClick = onOtw, modifier = Modifier.weight(1f).fillMaxHeight()) {
            // Mirrored to point right, as the web draws it.
            CommuteButtonIcon(CommuteIcons.NavigationArrow, modifier = Modifier.scale(scaleX = -1f, scaleY = 1f))
            CommuteButtonText(stringResource(R.string.station_otw))
        }
        if (onOpenTimetable != null) {
            CommuteButton(
                text = stringResource(R.string.station_full_timetable),
                onClick = onOpenTimetable,
                modifier = Modifier.weight(1f).fillMaxHeight(),
                variant = CommuteButtonVariant.Secondary,
            )
        }
    }
}

@Preview(showBackground = true)
@Composable
private fun StationActionsPreview() {
    CommutePreviewScaffold {
        StationActions(onOtw = {}, onOpenTimetable = {}, modifier = Modifier.padding(16.dp))
    }
}
