package id.shiorilabs.commute.feature.journey.presentation.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.shiorilabs.commute.core.ui.components.TransferIcon
import id.shiorilabs.commute.core.ui.components.VerticalSpacer
import id.shiorilabs.commute.core.ui.icons.CommuteIcons
import id.shiorilabs.commute.core.ui.theme.Amber700
import id.shiorilabs.commute.core.ui.theme.Rose700
import id.shiorilabs.commute.core.ui.theme.Slate400
import id.shiorilabs.commute.core.ui.theme.Slate500
import id.shiorilabs.commute.core.ui.theme.Slate700
import id.shiorilabs.commute.feature.journey.R
import id.shiorilabs.commute.feature.journey.domain.JOURNEY_LABELS_SHOWN
import id.shiorilabs.commute.feature.journey.domain.Journey
import id.shiorilabs.commute.feature.journey.domain.JourneyLabel
import id.shiorilabs.commute.feature.journey.domain.boardsAt
import id.shiorilabs.commute.feature.journey.domain.formatClock
import id.shiorilabs.commute.feature.journey.domain.formatDuration
import id.shiorilabs.commute.feature.journey.domain.formatKm
import id.shiorilabs.commute.feature.journey.domain.formatRupiah
import id.shiorilabs.commute.feature.journey.domain.isLastTrain
import id.shiorilabs.commute.feature.journey.domain.rides
import id.shiorilabs.commute.feature.journey.domain.routeBarSegments
import id.shiorilabs.commute.feature.journey.domain.sortJourneyLabels
import id.shiorilabs.commute.feature.station.domain.LineInfo

@Composable
internal fun JourneyLabel.text(): String = stringResource(
    when (this) {
        JourneyLabel.CHEAPEST -> R.string.journey_label_cheapest
        JourneyLabel.FEWEST_CHANGES -> R.string.journey_label_fewest_changes
        JourneyLabel.LEAST_WALKING -> R.string.journey_label_least_walking
        JourneyLabel.SHORTEST_WAIT -> R.string.journey_label_shortest_wait
    },
)

/**
 * One journey as a plate: the route bar, then how long it takes and when it leaves, the fare and why
 * it is offered, then the counts. The web's `JourneyCardFace`.
 *
 * Time leads where the journey is fully timed, since that is what tells several departures of one
 * route apart; an untimed one (anything through TransJakarta) leads with its fare instead. A plate
 * with [onClick] is an option to choose; without, it heads the detail.
 */
@Composable
internal fun JourneyCard(
    journey: Journey,
    lines: Map<String, LineInfo>,
    modifier: Modifier = Modifier,
    onClick: (() -> Unit)? = null,
) {
    val plate = if (onClick != null) OptionPlate else Color.White
    val labels = sortJourneyLabels(journey.labels).take(JOURNEY_LABELS_SHOWN)
    val lastTrain = journey.isLastTrain
    val boardsAt = journey.boardsAt
    val arrivalAt = journey.arrivalAt
    val duration = if (boardsAt != null && arrivalAt != null) formatDuration(boardsAt, arrivalAt).ifEmpty { null } else null
    val fareText = journey.totalFare?.let(::formatRupiah)
    val fareLeads = duration == null && fareText != null
    val headsign = journey.rides.firstOrNull()?.headsign

    Column(
        modifier = modifier
            .fillMaxWidth()
            .background(plate, MaterialTheme.shapes.extraSmall)
            .then(if (onClick != null) Modifier.clickable(role = Role.Button, onClick = onClick) else Modifier)
            .padding(16.dp),
    ) {
        RouteBar(segments = routeBarSegments(journey.legs) { legLines(it, lines) }, plateColor = plate)

        VerticalSpacer(12.dp)
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.Bottom,
        ) {
            Text(
                text = duration ?: fareText ?: stringResource(R.string.journey_transfer_count, journey.transferCount),
                modifier = Modifier.weight(1f),
                fontSize = 20.sp,
                fontWeight = FontWeight.Bold,
            )
            if (boardsAt != null) {
                Text(
                    text = buildAnnotatedString {
                        append(formatClock(boardsAt))
                        if (arrivalAt != null) {
                            withStyle(SpanStyle(color = Slate400)) { append(" → ") }
                            append(formatClock(arrivalAt))
                        }
                    },
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = Slate500,
                )
            }
        }

        if (!(fareLeads && labels.isEmpty() && !lastTrain)) {
            VerticalSpacer(4.dp)
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (!fareLeads) {
                    Text(
                        text = fareText ?: stringResource(R.string.journey_fare_unknown),
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.Bold,
                        color = Slate700,
                    )
                }
                JourneyTags(journey = journey, modifier = Modifier.weight(1f), textAlign = TextAlign.End)
            }
        }

        VerticalSpacer(6.dp)
        Row(
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            MetaText(formatKm(journey.totalDistanceM))
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
                TransferIcon(bus = false, modifier = Modifier.size(14.dp))
                MetaText(journey.transferCount.toString())
            }
            if (journey.walkDistanceM > 0) {
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(imageVector = CommuteIcons.Walk, contentDescription = null, modifier = Modifier.size(14.dp), tint = Slate500)
                    MetaText("${journey.walkDistanceM} m")
                }
            }
            if (headsign != null) {
                MetaText(stringResource(R.string.journey_headsign, headsign), modifier = Modifier.weight(1f, fill = false))
            }
        }
    }
}

/**
 * Why the journey is offered, led by a last-train warning: one line, or nothing when it has neither.
 * On the option plate beside its fare, and atop the trip page's detail.
 */
@Composable
internal fun JourneyTags(journey: Journey, modifier: Modifier = Modifier, textAlign: TextAlign? = null) {
    val lastTrain = journey.isLastTrain
    val labels = sortJourneyLabels(journey.labels).take(JOURNEY_LABELS_SHOWN)
    if (!lastTrain && labels.isEmpty()) return
    val lastTrainText = stringResource(R.string.journey_last_train)
    val labelTexts = labels.map { it.text() }
    Text(
        text = buildAnnotatedString {
            if (lastTrain) {
                withStyle(SpanStyle(color = Amber700)) { append(lastTrainText) }
            }
            if (lastTrain && labelTexts.isNotEmpty()) {
                withStyle(SpanStyle(color = Slate400)) { append(" · ") }
            }
            withStyle(SpanStyle(color = Rose700)) { append(labelTexts.joinToString(" · ")) }
        },
        modifier = modifier,
        fontSize = 12.sp,
        fontWeight = FontWeight.Bold,
        textAlign = textAlign,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
    )
}

@Composable
private fun MetaText(text: String, modifier: Modifier = Modifier) {
    Text(
        text = text,
        modifier = modifier,
        fontSize = 12.sp,
        color = Slate500,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
    )
}
