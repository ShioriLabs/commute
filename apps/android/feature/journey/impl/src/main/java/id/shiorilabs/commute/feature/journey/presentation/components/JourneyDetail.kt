package id.shiorilabs.commute.feature.journey.presentation.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.shiorilabs.commute.core.constants.OPERATOR_NAMES
import id.shiorilabs.commute.core.ui.components.VerticalSpacer
import id.shiorilabs.commute.core.ui.icons.CommuteIcons
import id.shiorilabs.commute.feature.journey.R
import id.shiorilabs.commute.feature.journey.domain.Journey
import id.shiorilabs.commute.feature.journey.domain.JourneyStop
import id.shiorilabs.commute.feature.journey.domain.formatClock
import id.shiorilabs.commute.feature.journey.domain.formatDuration
import id.shiorilabs.commute.feature.journey.domain.formatKm
import id.shiorilabs.commute.feature.journey.domain.formatRupiah
import id.shiorilabs.commute.feature.journey.domain.rides
import id.shiorilabs.commute.feature.journey.domain.surchargedTransfers
import id.shiorilabs.commute.feature.station.domain.LineInfo

/*
 * One journey in full, under its card on the trip page: the whole trip's clock, the timeline, the
 * recap, the fare breakdown and the disclaimer. The detail half of the web's `FareResultCard`.
 */

@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun JourneyDetail(journey: Journey, lines: Map<String, LineInfo>) {
    val rides = journey.rides
    val departureAt = rides.firstOrNull()?.departureAt
    val arrivalAt = journey.arrivalAt
    val surcharged = journey.surchargedTransfers

    // The whole trip's clock, where it says more than the one ride's own times would.
    if (departureAt != null && arrivalAt != null && rides.size > 1) {
        VerticalSpacer(16.dp)
        Text(
            text = stringResource(R.string.journey_departs_arrives, formatClock(departureAt), formatClock(arrivalAt)),
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.SemiBold,
            color = Slate700,
        )
    }

    JourneyTimeline(legs = journey.legs, lines = lines, modifier = Modifier.padding(top = 24.dp))

    FlowRow(
        modifier = Modifier.padding(top = 24.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        if (departureAt != null && arrivalAt != null) {
            RecapText(formatDuration(departureAt, arrivalAt), strong = true)
        }
        RecapText(stringResource(R.string.journey_transfer_count, journey.transferCount))
        journey.totalFare?.let { RecapText(formatRupiah(it), strong = true) }
        RecapText(formatKm(journey.totalDistanceM))
    }

    if (journey.segments.size + surcharged.size > 1) {
        VerticalSpacer(8.dp)
        Text(
            text = stringResource(R.string.journey_fare_breakdown),
            modifier = Modifier.semantics { heading() },
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.Bold,
        )
        Column(modifier = Modifier.padding(top = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            journey.segments.forEach { segment ->
                BreakdownRow(
                    title = OPERATOR_NAMES[segment.operator] ?: segment.operator,
                    from = segment.from,
                    to = segment.to,
                    fare = segment.fare?.let(::formatRupiah) ?: stringResource(R.string.journey_fare_na),
                )
            }
            surcharged.forEach { leg ->
                BreakdownRow(
                    title = leg.corridorLabel.orEmpty(),
                    from = leg.from,
                    to = leg.to,
                    fare = leg.fare?.let(::formatRupiah).orEmpty(),
                )
            }
        }
    }

    Text(
        text = stringResource(R.string.journey_disclaimer),
        modifier = Modifier.padding(top = 24.dp),
        fontSize = 12.sp,
        color = Slate400,
    )
}

@Composable
private fun RecapText(text: String, strong: Boolean = false) {
    Text(
        text = text,
        style = MaterialTheme.typography.bodyMedium,
        fontWeight = if (strong) FontWeight.Bold else FontWeight.Normal,
        color = if (strong) Slate700 else Slate500,
    )
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun BreakdownRow(title: String, from: JourneyStop, to: JourneyStop, fare: String) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(Stone100, MaterialTheme.shapes.extraSmall)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(text = title, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Bold)
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(4.dp),
                itemVerticalAlignment = Alignment.CenterVertically,
            ) {
                Text(text = from.name, style = MaterialTheme.typography.bodyMedium, color = Slate500)
                Icon(imageVector = CommuteIcons.Chevron, contentDescription = null, modifier = Modifier.size(12.dp), tint = Slate500)
                Text(text = to.name, style = MaterialTheme.typography.bodyMedium, color = Slate500)
            }
        }
        Text(text = fare, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Bold)
    }
}
