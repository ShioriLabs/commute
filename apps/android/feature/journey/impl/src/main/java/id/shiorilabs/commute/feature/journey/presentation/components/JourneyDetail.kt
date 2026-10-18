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
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.shiorilabs.commute.core.constants.OPERATOR_NAMES
import id.shiorilabs.commute.core.time.formatClock
import id.shiorilabs.commute.core.ui.components.NoticeBanner
import id.shiorilabs.commute.core.ui.components.VerticalSpacer
import id.shiorilabs.commute.core.ui.icons.CommuteIcons
import id.shiorilabs.commute.core.ui.preview.CommutePreviewScaffold
import id.shiorilabs.commute.core.ui.theme.Slate400
import id.shiorilabs.commute.core.ui.theme.Slate500
import id.shiorilabs.commute.core.ui.theme.Slate700
import id.shiorilabs.commute.feature.journey.R
import id.shiorilabs.commute.feature.journey.domain.Journey
import id.shiorilabs.commute.feature.journey.domain.JourneyStop
import id.shiorilabs.commute.feature.journey.domain.LeaveIn
import id.shiorilabs.commute.feature.journey.domain.TimedLeg
import id.shiorilabs.commute.feature.journey.domain.formatDuration
import id.shiorilabs.commute.feature.journey.domain.formatKm
import id.shiorilabs.commute.feature.journey.domain.formatRupiah
import id.shiorilabs.commute.feature.journey.domain.isLastTrain
import id.shiorilabs.commute.feature.journey.domain.leaveInOf
import id.shiorilabs.commute.feature.journey.domain.resolveTimedLegs
import id.shiorilabs.commute.feature.journey.domain.rides
import id.shiorilabs.commute.feature.journey.domain.surchargedTransfers
import id.shiorilabs.commute.feature.journey.presentation.JourneyPreviewData
import id.shiorilabs.commute.feature.station.domain.LineInfo
import java.time.Instant

/*
 * One journey in full, under the trip page's header (which carries its route bar, clock and fare):
 * why it is offered, the timeline, the recap, the fare breakdown and the disclaimer. The detail half
 * of the web's `FareResultCard`.
 */

@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun JourneyDetail(
    journey: Journey,
    lines: Map<String, LineInfo>,
    now: Instant,
    timed: List<TimedLeg> = emptyList(),
    onPickDeparture: (legIndex: Int, tripId: String) -> Unit = { _, _ -> },
) {
    val departureAt = journey.rides.firstOrNull()?.departureAt
    val arrivalAt = journey.arrivalAt
    val surcharged = journey.surchargedTransfers

    JourneyTags(journey = journey)

    val tagged = journey.isLastTrain || journey.labels.isNotEmpty()

    // Tonight's service is over: say so, and when it starts again, rather than leave a timeline
    // that looks like a journey someone can take.
    journey.resumesAt?.let { resumesAt ->
        NoticeBanner(
            message = stringResource(R.string.journey_service_ended, formatClock(resumesAt)),
            modifier = Modifier.padding(top = if (tagged) 16.dp else 0.dp),
        )
    }

    // The countdown follows the journey as the rider's picks have retimed it.
    val leaveIn = departureAt?.let { leaveInOf(it, now) }
    if (leaveIn != null) {
        Text(
            text = when (leaveIn) {
                LeaveIn.Gone -> stringResource(R.string.journey_left_already)
                LeaveIn.Now -> stringResource(R.string.journey_leave_now)
                is LeaveIn.InMinutes -> stringResource(R.string.journey_leave_in, leaveIn.minutes)
            },
            modifier = Modifier.padding(top = 16.dp).semantics { heading() },
            style = MaterialTheme.typography.titleLarge,
            fontWeight = FontWeight.Bold,
        )
    }
    // A span only means something with two rides or more: the waiting and walking between them. With
    // one, the boarding row and the header already say it.
    if (departureAt != null && arrivalAt != null && journey.rides.size > 1) {
        Text(
            text = if (leaveIn != null) {
                stringResource(R.string.journey_clock_arrives, formatClock(arrivalAt))
            } else {
                stringResource(R.string.journey_clock_departs_arrives, formatClock(departureAt), formatClock(arrivalAt))
            },
            modifier = Modifier.padding(top = if (leaveIn != null) 4.dp else 16.dp),
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.SemiBold,
            color = Slate700,
        )
    }

    val timelineTop = if (tagged || journey.resumesAt != null || leaveIn != null || (arrivalAt != null && journey.rides.size > 1)) 16.dp else 0.dp
    JourneyTimeline(
        legs = journey.legs,
        lines = lines,
        modifier = Modifier.padding(top = timelineTop),
        timed = timed,
        onPickDeparture = onPickDeparture,
    )

    FlowRow(
        modifier = Modifier.padding(top = 24.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
        itemVerticalAlignment = Alignment.CenterVertically,
    ) {
        if (journey.rides.isEmpty()) {
            // Nothing to ride: the recap is just the walk.
            RecapText(stringResource(R.string.journey_walk_only_summary, journey.walkDistanceM), strong = true)
        } else if (departureAt != null && arrivalAt != null) {
            RecapText(formatDuration(departureAt, arrivalAt), strong = true)
        }
        if (journey.rides.isNotEmpty()) {
            RecapText(stringResource(R.string.journey_transfer_count, journey.transferCount))
            journey.totalFare?.let { RecapText(formatRupiah(it), strong = true) }
            RecapText(formatKm(journey.totalDistanceM))
        }
        if (journey.rides.isNotEmpty() && journey.walkDistanceM > 0) {
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(imageVector = CommuteIcons.Walk, contentDescription = null, modifier = Modifier.size(16.dp), tint = Slate500)
                RecapText("${journey.walkDistanceM} m")
            }
        }
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

@Preview(showBackground = true, heightDp = 900)
@Composable
private fun JourneyDetailPreview() {
    val journey = JourneyPreviewData.journey
    CommutePreviewScaffold {
        Column(modifier = Modifier.padding(horizontal = 32.dp, vertical = 16.dp)) {
            JourneyDetail(
                journey = journey,
                lines = JourneyPreviewData.lines,
                now = JourneyPreviewData.now,
                timed = resolveTimedLegs(journey.legs, picks = emptyMap()),
            )
        }
    }
}
