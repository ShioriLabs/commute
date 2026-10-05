package id.shiorilabs.commute.feature.journey.presentation.components

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
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
import id.shiorilabs.commute.core.ui.theme.Amber100
import id.shiorilabs.commute.core.ui.theme.Amber800
import id.shiorilabs.commute.core.ui.theme.Rose300
import id.shiorilabs.commute.core.ui.theme.Rose500
import id.shiorilabs.commute.core.ui.theme.Rose700
import id.shiorilabs.commute.core.ui.theme.Slate300
import id.shiorilabs.commute.core.ui.theme.Slate400
import id.shiorilabs.commute.core.ui.theme.Slate500
import id.shiorilabs.commute.core.ui.theme.Slate600
import id.shiorilabs.commute.core.ui.theme.Slate900
import java.time.Instant
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.sp
import id.shiorilabs.commute.core.ui.components.LineRoundel
import id.shiorilabs.commute.core.ui.components.RoundelSize
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

/** The web's `duration-300` on the stops' reveal, and Tailwind's default 150 ms on the chevron. */
private const val STOPS_REVEAL_MILLIS = 300
private const val CHEVRON_TURN_MILLIS = 150

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
 * The journey leg by leg, down a rail in each line's colour: where to board and from which platform,
 * which line and which way, how many stops (which open out), and where to get off, each stop's time
 * down the right where the timetable has one; and between rides, the change or the walk. The web's
 * `JourneyTimeline` in its order, drawn as the live trip screen draws a ride.
 */
@Composable
internal fun JourneyTimeline(legs: List<JourneyLeg>, lines: Map<String, LineInfo>, modifier: Modifier = Modifier) {
    Column(modifier = modifier.fillMaxWidth()) {
        (legs.firstOrNull() as? JourneyLeg.Transfer)?.let { EndpointStop(it.from.name, RailCap.START) }
        legs.forEachIndexed { index, leg ->
            when (leg) {
                is JourneyLeg.Ride -> {
                    val previous = legs.getOrNull(index - 1)
                    // Two rides through the same station: a change on the spot, not a walk.
                    val sameStationChange = previous is JourneyLeg.Ride && previous.to.id == leg.from.id
                    RideLeg(
                        leg = leg,
                        lines = legLines(leg, lines),
                        sameStationChange = sameStationChange,
                        walkBefore = walkRail(previous),
                        walkAfter = walkRail(legs.getOrNull(index + 1)),
                    )
                }

                is JourneyLeg.Transfer -> TransferLeg(leg)
            }
        }
        (legs.lastOrNull() as? JourneyLeg.Transfer)?.let { EndpointStop(it.to.name, RailCap.END) }
    }
}

/**
 * Where the trip starts or ends on foot. A ride draws its own two nodes, but a walk is only a row of
 * text, so a trip that opens with one began at a station the timeline never named: Sudirman to Blok M
 * BCA read as starting at Dukuh Atas BNI. Slate rather than a line's colour, no line running here:
 * it is the walk's own rail, given an end.
 */
@Composable
private fun EndpointStop(name: String, cap: RailCap) {
    TimelineRow(rail = SolidColor(Slate300), cap = cap, node = Slate400) {
        StopLine(time = null) {
            Text(text = name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
        }
    }
}

/**
 * The rail of the walk beside a ride, so the two meet at the ride's node. A ride's own rail starts
 * and stops at its node's centre and a walk's only fills its own row, so the half-row between them
 * was bare; the ride draws that half in the walk's colour, being the one that knows where its node
 * sits.
 */
private fun walkRail(leg: JourneyLeg?): Brush? = when {
    leg !is JourneyLeg.Transfer -> null
    leg.corridorLabel != null && leg.fare != null -> SolidColor(Rose300)
    else -> SolidColor(Slate300)
}

/**
 * One row of the timeline: the gutter with its rail, and the row's content beside it. A [cap]ped rail
 * runs from or to the row's middle; [beyondCap], if given, fills the half the cap leaves bare.
 */
@Composable
private fun TimelineRow(
    rail: Brush?,
    modifier: Modifier = Modifier,
    cap: RailCap = RailCap.NONE,
    beyondCap: Brush? = null,
    node: Color? = null,
    dot: Color? = null,
    content: @Composable () -> Unit,
) {
    Row(modifier = modifier.fillMaxWidth().height(IntrinsicSize.Min)) {
        Box(modifier = Modifier.width(Gutter).fillMaxHeight()) {
            if (rail != null) {
                Column(modifier = Modifier.fillMaxHeight().offset(x = RailCenter - RailWidth / 2)) {
                    val top = if (cap == RailCap.START) beyondCap else rail
                    val bottom = if (cap == RailCap.END) beyondCap else rail
                    Box(Modifier.width(RailWidth).weight(1f).then(if (top != null) Modifier.background(top) else Modifier))
                    Box(Modifier.width(RailWidth).weight(1f).then(if (bottom != null) Modifier.background(bottom) else Modifier))
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
            if (dot != null) {
                Box(
                    modifier = Modifier
                        .align(Alignment.CenterStart)
                        .offset(x = RailCenter - 5.dp)
                        .size(10.dp)
                        .clip(CircleShape)
                        .background(Color.White)
                        .border(3.dp, dot, CircleShape),
                )
            }
        }
        Box(modifier = Modifier.weight(1f), contentAlignment = Alignment.CenterStart) {
            content()
        }
    }
}

private enum class RailCap { NONE, START, END }

@Composable
private fun RideLeg(
    leg: JourneyLeg.Ride,
    lines: List<LegLine>,
    sameStationChange: Boolean,
    walkBefore: Brush?,
    walkAfter: Brush?,
) {
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

    TimelineRow(rail = rail, cap = RailCap.START, beyondCap = walkBefore, node = legColor) {
        StopLine(time = leg.departureAt) {
            Text(text = leg.from.name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            leg.platformCode?.let { platform ->
                val formatted = formatPlatformCode(platform)
                val description = stringResource(R.string.journey_platform_description, formatted)
                Text(
                    text = stringResource(R.string.journey_platform, formatted),
                    modifier = Modifier.clearAndSetSemantics { contentDescription = description },
                    style = MaterialTheme.typography.labelMedium,
                    color = Slate500,
                )
            }
        }
    }

    TimelineRow(rail = rail) {
        Column(
            modifier = Modifier.padding(vertical = 10.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            // Each line as the live trip names it: its roundel, then its name.
            lines.forEach { line ->
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    LineRoundel(code = line.code, color = line.color, operator = leg.operator, size = RoundelSize.SM)
                    Text(text = line.name, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold, color = Slate900)
                    if (leg.lastService && line == lines.first()) {
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
            if (lines.size > 1) {
                RideNote(stringResource(if (isBus) R.string.journey_board_any_bus else R.string.journey_board_any_train))
            }
            if (directions.isNotEmpty()) {
                RideNote(stringResource(R.string.journey_headsign, joinLabels(directions)))
            }
            val summary = stringResource(R.string.journey_ride_summary, leg.stationCount - 1, formatKm(leg.distanceM))
            if (intermediate.isEmpty()) {
                Text(text = summary, style = MaterialTheme.typography.bodyMedium, color = Slate500)
            } else {
                val chevron by animateFloatAsState(
                    targetValue = if (expanded) 180f else 0f,
                    animationSpec = tween(CHEVRON_TURN_MILLIS, easing = FastOutSlowInEasing),
                    label = "stops-chevron",
                )
                Row(
                    modifier = Modifier
                        .clickable(role = Role.Button) { expanded = !expanded },
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(text = summary, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Bold, color = Slate500)
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

    // The stops passed through, on the rail itself, as the line strip draws them. Revealed the
    // way the web does it (grid rows 0fr to 1fr): height only, from the top, clipped. No fade,
    // which would leave the rail see-through mid-reveal.
    AnimatedVisibility(
        visible = expanded && intermediate.isNotEmpty(),
        enter = expandVertically(tween(STOPS_REVEAL_MILLIS, easing = FastOutSlowInEasing), expandFrom = Alignment.Top),
        exit = shrinkVertically(tween(STOPS_REVEAL_MILLIS, easing = FastOutSlowInEasing), shrinkTowards = Alignment.Top),
    ) {
        Column {
            intermediate.forEachIndexed { i, stop ->
                TimelineRow(rail = rail, dot = legColor) {
                    StopLine(time = leg.stopTimes.getOrNull(i + 1), padding = 6.dp) {
                        Text(text = stop.name, style = MaterialTheme.typography.bodyMedium, color = Slate900)
                    }
                }
            }
        }
    }

    TimelineRow(rail = rail, cap = RailCap.END, beyondCap = walkAfter, node = legColor) {
        StopLine(time = leg.arrivalAt) {
            Text(text = leg.to.name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            val description = stringResource(R.string.journey_get_off_description)
            Text(
                text = stringResource(R.string.journey_get_off),
                modifier = Modifier
                    .padding(top = 2.dp)
                    .clip(RoundedCornerShape(4.dp))
                    .background(MaterialTheme.colorScheme.primary)
                    .padding(horizontal = 6.dp, vertical = 1.dp)
                    .clearAndSetSemantics { contentDescription = description },
                style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onPrimary,
            )
        }
    }
}

/**
 * A stop's line beside the rail: its name (and whatever goes under it) on the left, its time on the
 * right in figures of one width, so the times line up down the ride. No time, no column: TransJakarta
 * publishes none, and a dash would read as one we failed to fetch.
 */
@Composable
private fun StopLine(time: Instant?, padding: Dp = 2.dp, content: @Composable () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = padding)
            .semantics(mergeDescendants = true) {},
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) { content() }
        time?.let {
            Text(
                text = formatClock(it),
                modifier = Modifier.padding(start = 12.dp),
                style = MaterialTheme.typography.labelLarge.merge(fontFeatureSettings = "tnum"),
                color = Slate500,
            )
        }
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
    // The breathing room is padding on the content, not on the row: outside the row, its rail can't
    // reach, which left a gap at both ends of every walk.
    if (fare != null && corridor != null) {
        TimelineRow(rail = SolidColor(Rose300)) {
            Row(
                modifier = Modifier.padding(vertical = 14.dp),
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

    TimelineRow(rail = SolidColor(Slate300)) {
        Row(
            modifier = Modifier.padding(vertical = 14.dp),
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
