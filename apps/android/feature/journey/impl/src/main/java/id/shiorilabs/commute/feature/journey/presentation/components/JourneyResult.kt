package id.shiorilabs.commute.feature.journey.presentation.components

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
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
import id.shiorilabs.commute.feature.journey.presentation.JourneyPage
import id.shiorilabs.commute.feature.station.domain.LineInfo

/**
 * The answer: a list of options to choose between, or one journey's detail, with a way back to the
 * list when there was one. A lone journey was never compared against anything, so it shows as the
 * detail it is. The web's `FareResultCard`.
 */
@Composable
internal fun JourneyResult(
    journeys: List<Journey>,
    page: JourneyPage,
    selected: Int,
    lines: Map<String, LineInfo>,
    onSelect: (Int) -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val hasOptions = journeys.size > 1
    val showing = if (hasOptions) page else JourneyPage.DETAIL

    Column(modifier = modifier.fillMaxWidth()) {
        if (hasOptions) {
            Box(modifier = Modifier.height(32.dp), contentAlignment = Alignment.CenterStart) {
                if (showing == JourneyPage.DETAIL) {
                    val backDescription = stringResource(R.string.journey_detail_back)
                    Row(
                        modifier = Modifier
                            .clickable(role = Role.Button, onClick = onBack)
                            .semantics { contentDescription = backDescription }
                            .padding(vertical = 4.dp),
                        horizontalArrangement = Arrangement.spacedBy(4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(imageVector = CommuteIcons.Back, contentDescription = null, modifier = Modifier.size(14.dp), tint = Slate500)
                        Text(
                            text = stringResource(R.string.journey_detail),
                            style = MaterialTheme.typography.bodyMedium,
                            fontWeight = FontWeight.Bold,
                            color = Slate500,
                        )
                    }
                } else {
                    Text(
                        text = stringResource(R.string.journey_options, journeys.size),
                        modifier = Modifier.semantics { heading() },
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.Bold,
                        color = Slate500,
                    )
                }
            }
        }

        AnimatedContent(
            targetState = showing,
            transitionSpec = { fadeIn() togetherWith fadeOut() },
            label = "journey-page",
        ) { shown ->
            when (shown) {
                JourneyPage.OPTIONS -> Column(
                    modifier = Modifier.padding(top = 8.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    journeys.forEachIndexed { index, journey ->
                        JourneyCard(journey = journey, lines = lines, onClick = { onSelect(index) })
                    }
                }

                JourneyPage.DETAIL -> {
                    val journey = journeys.getOrNull(selected) ?: journeys.first()
                    Column {
                        JourneyCard(journey = journey, lines = lines)
                        JourneyDetail(journey = journey, lines = lines)
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun JourneyDetail(journey: Journey, lines: Map<String, LineInfo>) {
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
