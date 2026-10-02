package id.shiorilabs.commute.feature.journey.presentation.components

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.shiorilabs.commute.core.ui.components.LineRoundel
import id.shiorilabs.commute.core.ui.components.RoundelSize
import id.shiorilabs.commute.core.ui.ext.Foreground
import id.shiorilabs.commute.core.ui.ext.foreground
import id.shiorilabs.commute.core.ui.ext.parseHexColor
import id.shiorilabs.commute.core.ui.icons.CommuteIcons
import id.shiorilabs.commute.feature.journey.R
import id.shiorilabs.commute.feature.journey.domain.JourneyLeg
import id.shiorilabs.commute.feature.journey.domain.LINE_COLOR_FALLBACK
import id.shiorilabs.commute.feature.journey.domain.LegLine
import id.shiorilabs.commute.feature.journey.domain.formatClock
import id.shiorilabs.commute.feature.journey.domain.formatKm
import id.shiorilabs.commute.feature.journey.domain.formatRupiah
import id.shiorilabs.commute.feature.station.domain.LineInfo
import id.shiorilabs.commute.feature.station.domain.codeOfLineKey
import id.shiorilabs.commute.feature.station.domain.formatPlatformCode
import id.shiorilabs.commute.feature.station.domain.joinLabels

private const val TRANSJAKARTA = "TJ"

/** The gutter the rail runs down, and where its centre sits: the web's fare timeline grid. */
private val Gutter = 28.dp
private val RailCenter = 14.dp

/** The lines that run a ride, resolved against the dictionary; a key it lacks still shows its code. */
internal fun legLines(ride: JourneyLeg.Ride, lines: Map<String, LineInfo>): List<LegLine> =
    ride.serviceLines.map { service ->
        val info = lines[service.line]
        LegLine(
            key = service.line,
            code = codeOfLineKey(service.line),
            name = info?.name ?: codeOfLineKey(service.line),
            color = info?.colorCode ?: LINE_COLOR_FALLBACK,
            headsign = service.headsign,
        )
    }

/** A vehicle with the swap arrows on it: a change, by train or by bus. The web's `TransferIcon`. */
@Composable
internal fun TransferIcon(bus: Boolean, modifier: Modifier = Modifier, tint: Color = Slate500) {
    Box(modifier = modifier) {
        Icon(
            imageVector = if (bus) CommuteIcons.Bus else CommuteIcons.Train,
            contentDescription = null,
            modifier = Modifier.fillMaxWidth().fillMaxHeight(),
            tint = tint,
        )
        Box(
            modifier = Modifier
                .align(Alignment.BottomEnd)
                .offset(x = 2.dp, y = 1.dp)
                .fillMaxWidth(0.65f)
                .fillMaxHeight(0.65f)
                .clip(CircleShape)
                .background(tint),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                imageVector = CommuteIcons.Swap,
                contentDescription = null,
                modifier = Modifier.fillMaxWidth(0.8f).fillMaxHeight(0.8f),
                tint = Color.White,
            )
        }
    }
}

/**
 * The journey leg by leg, down a rail in each line's colour: where to board, which line and which
 * way, when, how many stops (which open out), and where to get off; and between rides, the change or
 * the walk. The web's `JourneyTimeline`.
 */
@Composable
internal fun JourneyTimeline(legs: List<JourneyLeg>, lines: Map<String, LineInfo>, modifier: Modifier = Modifier) {
    Column(modifier = modifier.fillMaxWidth()) {
        legs.forEachIndexed { index, leg ->
            when (leg) {
                is JourneyLeg.Ride -> {
                    val previous = legs.getOrNull(index - 1)
                    // Two rides through the same station: a change on the spot, not a walk.
                    val sameStationChange = previous is JourneyLeg.Ride && previous.to.id == leg.from.id
                    RideLeg(leg, legLines(leg, lines), sameStationChange)
                }

                is JourneyLeg.Transfer -> TransferLeg(leg)
            }
        }
    }
}

/** One row of the timeline: the gutter with its rail, and the row's content beside it. */
@Composable
private fun TimelineRow(
    rail: Brush?,
    modifier: Modifier = Modifier,
    cap: RailCap = RailCap.NONE,
    node: Color? = null,
    tick: Boolean = false,
    content: @Composable () -> Unit,
) {
    Row(modifier = modifier.fillMaxWidth().height(IntrinsicSize.Min)) {
        Box(modifier = Modifier.width(Gutter).fillMaxHeight()) {
            if (rail != null) {
                Column(modifier = Modifier.fillMaxHeight().offset(x = RailCenter - RailWidth / 2)) {
                    Box(Modifier.width(RailWidth).weight(1f).then(if (cap == RailCap.START) Modifier else Modifier.background(rail)))
                    Box(Modifier.width(RailWidth).weight(1f).then(if (cap == RailCap.END) Modifier else Modifier.background(rail)))
                }
            }
            if (node != null) {
                Box(
                    modifier = Modifier
                        .align(Alignment.CenterStart)
                        .offset(x = RailCenter - 8.dp)
                        .size(16.dp)
                        .clip(CircleShape)
                        .background(Color.White)
                        .border(4.dp, node, CircleShape),
                )
            }
            if (tick) {
                // A tick across the rail, not a hole: gaps at this width read as a dashed line.
                Box(
                    modifier = Modifier
                        .align(Alignment.CenterStart)
                        .offset(x = RailCenter - RailWidth / 2)
                        .size(width = RailWidth, height = 2.dp)
                        .clip(CircleShape)
                        .background(Color.White),
                )
            }
        }
        Box(modifier = Modifier.weight(1f), contentAlignment = Alignment.CenterStart) {
            content()
        }
    }
}

private enum class RailCap { NONE, START, END }

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun RideLeg(leg: JourneyLeg.Ride, lines: List<LegLine>, sameStationChange: Boolean) {
    var expanded by rememberSaveable(leg.from.id, leg.to.id, leg.line) { mutableStateOf(false) }
    val isBus = leg.operator == TRANSJAKARTA
    val legColor = parseHexColor(lines.firstOrNull()?.color ?: LINE_COLOR_FALLBACK)
    val rail = trackBrush(lines.map { it.color }, vertical = true)
    val intermediate = leg.stops.drop(1).dropLast(1)
    val directions = lines.mapNotNull { it.headsign }.distinct()

    if (sameStationChange) {
        TimelineRow(rail = SolidColor(Slate300)) {
            Row(
                modifier = Modifier.padding(vertical = 6.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                TransferIcon(bus = isBus, modifier = Modifier.size(14.dp))
                Text(
                    text = stringResource(if (isBus) R.string.journey_change_bus else R.string.journey_change_train),
                    style = MaterialTheme.typography.bodyMedium,
                    color = Slate500,
                )
            }
        }
    }

    TimelineRow(rail = rail, cap = RailCap.START, node = legColor) {
        FlowRow(
            modifier = Modifier.padding(vertical = 2.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            itemVerticalAlignment = Alignment.CenterVertically,
        ) {
            Text(text = leg.from.name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            leg.platformCode?.let { platform ->
                val formatted = formatPlatformCode(platform)
                val description = stringResource(R.string.journey_platform_description, formatted)
                Text(
                    text = stringResource(R.string.journey_platform, formatted),
                    modifier = Modifier
                        .clip(CircleShape)
                        .background(legColor.copy(alpha = 0.2f))
                        .padding(horizontal = 8.dp, vertical = 2.dp)
                        .clearAndSetSemantics { contentDescription = description },
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Bold,
                    color = Slate900,
                )
            }
        }
    }

    TimelineRow(rail = rail) {
        Column(
            modifier = Modifier.padding(vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                lines.forEach { line ->
                    if (isBus) {
                        LineRoundel(code = line.code, color = line.color, operator = leg.operator, size = RoundelSize.SM)
                    } else {
                        val color = parseHexColor(line.color)
                        Text(
                            text = line.name,
                            modifier = Modifier
                                .background(color, RoundedCornerShape(6.dp))
                                .padding(horizontal = 12.dp, vertical = 4.dp),
                            style = MaterialTheme.typography.bodyMedium,
                            fontWeight = FontWeight.SemiBold,
                            color = if (color.foreground() == Foreground.LIGHT) Color.White else Slate900,
                        )
                    }
                }
            }
            if (lines.size > 1) {
                RideNote(stringResource(if (isBus) R.string.journey_board_any_bus else R.string.journey_board_any_train))
            }
            if (directions.isNotEmpty()) {
                RideNote(stringResource(R.string.journey_headsign, joinLabels(directions)))
            }
            val departureAt = leg.departureAt
            val arrivalAt = leg.arrivalAt
            // Only where the timetable covers this leg; TransJakarta publishes none, and a dash
            // would read as a time we failed to fetch.
            if (departureAt != null && arrivalAt != null) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        text = "${formatClock(departureAt)} - ${formatClock(arrivalAt)}",
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.SemiBold,
                        color = Slate700,
                    )
                    if (leg.lastService) {
                        Text(
                            text = stringResource(R.string.journey_last_service),
                            modifier = Modifier
                                .clip(CircleShape)
                                .background(Amber100)
                                .padding(horizontal = 8.dp, vertical = 2.dp),
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Bold,
                            color = Amber800,
                        )
                    }
                }
            }
            val summary = stringResource(R.string.journey_ride_summary, leg.stationCount - 1, formatKm(leg.distanceM))
            if (intermediate.isEmpty()) {
                Text(text = summary, style = MaterialTheme.typography.bodyMedium, color = Slate500)
            } else {
                val chevron by animateFloatAsState(if (expanded) 180f else 0f, label = "stops-chevron")
                Row(
                    modifier = Modifier
                        .clickable(role = Role.Button) { expanded = !expanded },
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(text = summary, style = MaterialTheme.typography.bodyMedium, color = Slate500)
                    Icon(
                        imageVector = CommuteIcons.MoveDown,
                        contentDescription = null,
                        modifier = Modifier.size(14.dp).rotate(chevron),
                        tint = Slate500,
                    )
                }
            }
        }
    }

    // The stops passed through, on the rail itself, as the line strip draws them.
    AnimatedVisibility(visible = expanded && intermediate.isNotEmpty()) {
        Column {
            intermediate.forEach { stop ->
                TimelineRow(rail = rail, tick = true) {
                    Text(
                        text = stop.name,
                        modifier = Modifier.padding(vertical = 4.dp),
                        style = MaterialTheme.typography.bodyMedium,
                        color = Slate600,
                    )
                }
            }
        }
    }

    TimelineRow(rail = rail, cap = RailCap.END, node = legColor) {
        Text(
            text = leg.to.name,
            modifier = Modifier.padding(vertical = 2.dp),
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.Bold,
        )
    }
}

@Composable
private fun RideNote(text: String) {
    Text(text = text, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium, color = Slate600)
}

@Composable
private fun TransferLeg(leg: JourneyLeg.Transfer) {
    val fare = leg.fare
    val corridor = leg.corridorLabel
    if (fare != null && corridor != null) {
        TimelineRow(rail = SolidColor(Rose300), modifier = Modifier.padding(vertical = 8.dp)) {
            Row(
                modifier = Modifier.padding(vertical = 6.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalAlignment = Alignment.Top,
            ) {
                Icon(
                    imageVector = CommuteIcons.Ticket,
                    contentDescription = null,
                    modifier = Modifier.padding(top = 2.dp).size(14.dp),
                    tint = Rose500,
                )
                Column {
                    Text(
                        text = buildAnnotatedString {
                            withStyle(SpanStyle(color = Rose700)) {
                                append("$corridor • ")
                                withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { append(formatRupiah(fare)) }
                            }
                        },
                        style = MaterialTheme.typography.bodyMedium,
                    )
                    if (leg.distanceM > 0) {
                        Text(
                            text = stringResource(R.string.journey_walk, leg.distanceM),
                            style = MaterialTheme.typography.bodyMedium,
                            color = Slate500,
                        )
                    }
                }
            }
        }
        return
    }

    TimelineRow(rail = SolidColor(Slate300), modifier = Modifier.padding(vertical = 8.dp)) {
        Row(
            modifier = Modifier.padding(vertical = 6.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(imageVector = CommuteIcons.Walk, contentDescription = null, modifier = Modifier.size(14.dp), tint = Slate500)
            val walk = if (leg.distanceM > 0) " " + stringResource(R.string.journey_transfer_walk, leg.distanceM) else ""
            Text(
                text = stringResource(R.string.journey_transfer_to, leg.to.name) + walk,
                style = MaterialTheme.typography.bodyMedium,
                color = Slate500,
            )
        }
    }
}
