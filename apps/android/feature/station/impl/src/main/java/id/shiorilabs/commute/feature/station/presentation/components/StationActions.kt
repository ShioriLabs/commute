package id.shiorilabs.commute.feature.station.presentation.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import id.shiorilabs.commute.core.ui.icons.CommuteIcons
import id.shiorilabs.commute.core.ui.preview.CommutePreviewScaffold
import id.shiorilabs.commute.feature.station.R

private val Slate200 = Color(0xFFE2E8F0)

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
        ActionButton(
            text = stringResource(R.string.station_otw),
            onClick = onOtw,
            container = MaterialTheme.colorScheme.primary,
            content = MaterialTheme.colorScheme.onPrimary,
            leadingIcon = true,
        )
        if (onOpenTimetable != null) {
            ActionButton(
                text = stringResource(R.string.station_full_timetable),
                onClick = onOpenTimetable,
                container = Slate200,
                content = MaterialTheme.colorScheme.primary,
            )
        }
    }
}

/** The web's `p-4 rounded-xl text-sm font-bold` button, sharing the row with its neighbour. */
@Composable
private fun RowScope.ActionButton(
    text: String,
    onClick: () -> Unit,
    container: Color,
    content: Color,
    leadingIcon: Boolean = false,
) {
    Row(
        modifier = Modifier
            .weight(1f)
            .fillMaxHeight()
            .clip(RoundedCornerShape(12.dp))
            .background(container)
            .clickable(role = Role.Button, onClick = onClick)
            .padding(16.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (leadingIcon) {
            Icon(
                imageVector = CommuteIcons.NavigationArrow,
                contentDescription = null,
                // Mirrored to point right, as the web draws it.
                modifier = Modifier
                    .size(20.dp)
                    .scale(scaleX = -1f, scaleY = 1f),
                tint = content,
            )
        }
        Text(
            text = text,
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.Bold,
            color = content,
        )
    }
}

@Preview(showBackground = true)
@Composable
private fun StationActionsPreview() {
    CommutePreviewScaffold {
        StationActions(onOtw = {}, onOpenTimetable = {}, modifier = Modifier.padding(16.dp))
    }
}
