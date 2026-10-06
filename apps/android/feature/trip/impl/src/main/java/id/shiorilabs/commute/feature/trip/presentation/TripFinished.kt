package id.shiorilabs.commute.feature.trip.presentation

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.text.TextAutoSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.shiorilabs.commute.core.trip.FinishReason
import id.shiorilabs.commute.core.trip.TripLeg
import id.shiorilabs.commute.core.trip.TripStop
import id.shiorilabs.commute.core.trip.progress
import id.shiorilabs.commute.core.ui.components.CommuteCloseButton
import id.shiorilabs.commute.core.ui.components.LineRoundel
import id.shiorilabs.commute.core.ui.ext.lineColorOf
import id.shiorilabs.commute.core.ui.components.CommuteButton
import id.shiorilabs.commute.core.ui.components.CommuteButtonIcon
import id.shiorilabs.commute.core.ui.components.CommuteButtonText
import id.shiorilabs.commute.core.ui.components.CommuteButtonVariant
import id.shiorilabs.commute.core.ui.components.SectionLabel
import id.shiorilabs.commute.core.ui.icons.CommuteIcons
import id.shiorilabs.commute.core.ui.motion.IosSpringEasing
import id.shiorilabs.commute.core.ui.motion.rememberReducedMotion
import id.shiorilabs.commute.feature.station.domain.LineInfo
import id.shiorilabs.commute.feature.trip.R
import id.shiorilabs.commute.feature.trip.runtime.FinishedTrip
import java.time.Duration

private val DoneInk = Color(0xFF0F172A)
private val DoneMuted = Color(0xFF94A3B8)
private val DoneTrack = Color(0xFF334155)
private val DoneTile = Color(0xFFF1F5F9)
private val DoneLine = Color(0xFFE2E8F0)
private val DoneLabel = Color(0xFF64748B)

/**
 * The trip page's last word on a trip that has ended: the board's plate saying where the rider got
 * to, the whole route as one band lit as far as they rode, a few figures, each ride, and where to
 * go from here: the station they're at, or the way back.
 */
@Composable
internal fun TripFinished(
    finished: FinishedTrip,
    lines: Map<String, LineInfo>,
    copy: TripCopy,
    topInset: Dp,
    onClose: () -> Unit,
    onOpenStation: (TripStop) -> Unit,
    onRouteBack: () -> Unit,
) {
    val plan = finished.trip.plan
    val rides = plan.rideIndices.map(plan::ride)
    val destination = plan.destination
    val fraction = if (finished.reason == FinishReason.ARRIVED) 1f else finished.trip.state.progress(plan).fraction.toFloat()

    Column(modifier = Modifier.fillMaxWidth()) {
        Plate(finished.reason, destination, rides, lines, fraction, plan.ride(plan.rideIndices.first()).stops.first(), topInset, onClose)
        Figures(finished, rides, modifier = Modifier.padding(start = 20.dp, top = 24.dp, end = 20.dp))
        SectionLabel(
            text = stringResource(R.string.trip_done_summary),
            modifier = Modifier.padding(start = 32.dp, top = 32.dp, end = 32.dp, bottom = 12.dp),
            color = DoneMuted,
        )
        Column(
            modifier = Modifier
                .padding(horizontal = 20.dp)
                .clip(RoundedCornerShape(16.dp))
                .border(1.dp, DoneLine, RoundedCornerShape(16.dp)),
        ) {
            rides.forEachIndexed { index, ride ->
                if (index > 0) Box(modifier = Modifier.fillMaxWidth().height(1.dp).background(DoneLine))
                RideRow(ride, lines, copy)
            }
        }
        Column(
            modifier = Modifier.padding(start = 20.dp, top = 24.dp, end = 20.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            val lastRide = rides.last()
            CommuteButton(onClick = { onOpenStation(destination) }, modifier = Modifier.fillMaxWidth()) {
                CommuteButtonIcon(if (lastRide.isBus) CommuteIcons.Bus else CommuteIcons.Train)
                CommuteButtonText(
                    stringResource(if (lastRide.isBus) R.string.trip_done_open_halte else R.string.trip_done_open_station, destination.name),
                    maxLines = 1,
                )
            }
            CommuteButton(
                text = stringResource(R.string.trip_done_route_back),
                onClick = onRouteBack,
                modifier = Modifier.fillMaxWidth(),
                variant = CommuteButtonVariant.Secondary,
                leadingIcon = CommuteIcons.Swap,
            )
        }
    }
}

/** The board's dark plate, at the end: how it ended over the destination's big name, then the band. */
@Composable
private fun Plate(
    reason: FinishReason,
    destination: TripStop,
    rides: List<TripLeg.Ride>,
    lines: Map<String, LineInfo>,
    fraction: Float,
    origin: TripStop,
    topInset: Dp,
    onClose: () -> Unit,
) {
    DarkStatusBarIcons()
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(DoneInk)
            .padding(top = topInset)
            .padding(top = 4.dp, bottom = 24.dp),
    ) {
        Box(modifier = Modifier.fillMaxWidth().padding(end = 8.dp), contentAlignment = Alignment.CenterEnd) {
            CommuteCloseButton(
                onClick = onClose,
                contentDescription = stringResource(R.string.trip_live_close),
                size = 40.dp,
                tint = Color.White,
            )
        }
        Column(modifier = Modifier.padding(horizontal = 20.dp)) {
            val eyebrow = stringResource(
                when (reason) {
                    FinishReason.ARRIVED -> R.string.trip_done_arrived
                    FinishReason.STOPPED -> R.string.trip_done_stopped
                    FinishReason.TIMED_OUT -> R.string.trip_done_timed_out
                },
            )
            Text(
                text = eyebrow,
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.Bold,
                color = DoneMuted,
            )
            Row(
                modifier = Modifier
                    .padding(top = 2.dp)
                    .semantics(mergeDescendants = true) { heading() },
                verticalAlignment = Alignment.CenterVertically,
            ) {
                StationLines(listOf(rides.last().line), lines)
                StationName(destination.name, modifier = Modifier.weight(1f).padding(start = 10.dp))
            }
            RouteBand(
                rides = rides,
                lines = lines,
                fraction = fraction,
                modifier = Modifier
                    .padding(top = 20.dp)
                    .fillMaxWidth()
                    .height(20.dp)
                    .clearAndSetSemantics {},
            )
            val description = stringResource(R.string.trip_done_route_description, origin.name, destination.name)
            Row(
                modifier = Modifier
                    .padding(top = 8.dp)
                    .clearAndSetSemantics { contentDescription = description },
            ) {
                Text(
                    text = origin.name,
                    modifier = Modifier.weight(1f),
                    style = MaterialTheme.typography.labelLarge,
                    color = DoneMuted,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    text = destination.name,
                    modifier = Modifier.padding(start = 12.dp),
                    style = MaterialTheme.typography.labelLarge,
                    color = Color.White,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

/**
 * The whole route as the Live Update draws it: a segment per ride in its line's colour, sized by
 * its stops, with a gap at each change, lit from the start as far as the rider got and drawn in
 * when the page opens. The rider ends as a white dot ringed in the line they were on.
 */
@Composable
private fun RouteBand(rides: List<TripLeg.Ride>, lines: Map<String, LineInfo>, fraction: Float, modifier: Modifier) {
    val reducedMotion = rememberReducedMotion()
    val lit = remember { Animatable(if (reducedMotion) fraction else 0f) }
    LaunchedEffect(fraction) {
        if (reducedMotion) lit.snapTo(fraction) else lit.animateTo(fraction, tween(DRAW_IN_MILLIS, easing = IosSpringEasing))
    }
    val colors = rides.map { ride -> lineColorOf(lines[ride.line]?.colorCode) }
    val weights = rides.map { it.lastIndex.coerceAtLeast(1).toFloat() }
    Canvas(modifier = modifier) {
        val thickness = 8.dp.toPx()
        val gap = 4.dp.toPx()
        val dot = size.height / 2
        // Room at both ends for the rider's dot, and between rides for the changes.
        val start = dot
        val usable = size.width - 2 * dot - gap * (rides.size - 1)
        val total = weights.sum()
        val y = size.height / 2
        val reached = start + usable * lit.value + gap * changesBefore(weights, lit.value)
        var x = start
        var riderColor = colors.first()
        rides.indices.forEach { i ->
            val length = usable * weights[i] / total
            val radius = CornerRadius(thickness / 2)
            drawRoundRect(DoneTrack, Offset(x, y - thickness / 2), Size(length, thickness), radius)
            val litLength = (reached - x).coerceIn(0f, length)
            if (litLength > 0f) {
                drawRoundRect(colors[i], Offset(x, y - thickness / 2), Size(litLength, thickness), radius)
                riderColor = colors[i]
            }
            x += length + gap
        }
        val riderX = reached.coerceIn(start, size.width - dot)
        drawCircle(riderColor, radius = dot, center = Offset(riderX, y))
        drawCircle(Color.White, radius = dot - 3.dp.toPx(), center = Offset(riderX, y))
        if (lit.value >= 1f) {
            // Arrived: a check in the dot.
            val s = dot * 0.4f
            val check = Path().apply {
                moveTo(riderX - s, y)
                lineTo(riderX - s * 0.25f, y + s * 0.7f)
                lineTo(riderX + s, y - s * 0.6f)
            }
            drawPath(
                check,
                riderColor,
                style = Stroke(width = 2.5.dp.toPx(), cap = StrokeCap.Round),
            )
        }
    }
}

/** How many changes lie before [fraction] of the way along rides weighted by [weights]. */
private fun changesBefore(weights: List<Float>, fraction: Float): Int {
    val total = weights.sum()
    var run = 0f
    return weights.dropLast(1).count { run += it; fraction * total >= run }
}

/** Time on the way (not for a trip closed long after), stops passed, and changes, as three tiles. */
@Composable
private fun Figures(finished: FinishedTrip, rides: List<TripLeg.Ride>, modifier: Modifier = Modifier) {
    val trip = finished.trip
    // Until getting there, not until the trip closed a few minutes after.
    val end = trip.state.arrivedAt ?: finished.at
    val minutes = Duration.between(trip.state.startedAt, end).toMinutes().toInt().coerceAtLeast(0)
    val stops = if (finished.reason == FinishReason.ARRIVED) {
        rides.sumOf { it.lastIndex }
    } else {
        (trip.state.progress(trip.plan).fraction * rides.sumOf { it.lastIndex }).toInt()
    }
    val changes = rides.size - 1
    Row(modifier = modifier.fillMaxWidth().height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        if (finished.reason != FinishReason.TIMED_OUT) {
            Figure(
                value = if (minutes < 60) {
                    stringResource(R.string.trip_done_minutes, minutes)
                } else {
                    stringResource(R.string.trip_done_hours, minutes / 60, minutes % 60)
                },
                label = stringResource(R.string.trip_done_on_the_way),
                modifier = Modifier.weight(1f),
            )
        }
        Figure(
            value = stops.toString(),
            label = stringResource(if (rides.all { it.isBus }) R.string.trip_done_haltes else R.string.trip_done_stations),
            modifier = Modifier.weight(1f),
        )
        Figure(
            value = if (changes == 0) stringResource(R.string.trip_done_direct) else stringResource(R.string.trip_done_changes, changes),
            label = stringResource(if (changes == 0) R.string.trip_done_direct_label else R.string.trip_done_changes_label),
            modifier = Modifier.weight(1f),
        )
    }
}

@Composable
private fun Figure(value: String, label: String, modifier: Modifier = Modifier) {
    Column(
        modifier = modifier
            .clip(RoundedCornerShape(16.dp))
            .background(DoneTile)
            .padding(horizontal = 14.dp, vertical = 12.dp)
            .semantics(mergeDescendants = true) {},
    ) {
        // Shrinks to fit a narrow tile ("Langsung") rather than cut it off.
        val style = MaterialTheme.typography.titleLarge.merge(color = DoneInk, fontWeight = FontWeight.Bold, fontFeatureSettings = "tnum")
        BasicText(
            text = value,
            style = style,
            maxLines = 1,
            autoSize = TextAutoSize.StepBased(minFontSize = 14.sp, maxFontSize = style.fontSize, stepSize = 1.sp),
        )
        Text(text = label, style = MaterialTheme.typography.bodySmall, color = DoneLabel)
    }
}

/** One ride: its line, from where to where and which way, and its times when it had them. */
@Composable
private fun RideRow(ride: TripLeg.Ride, lines: Map<String, LineInfo>, copy: TripCopy) {
    val line = lines[ride.line]
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .semantics(mergeDescendants = true) {}
            .padding(16.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        LineRoundel(
            code = line?.lineCode ?: ride.line.substringAfter(':'),
            color = line?.colorCode ?: "#94A3B8",
            operator = ride.operator,
        )
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = stringResource(R.string.trip_done_ride, ride.stops.first().name, ride.stops.last().name),
                style = MaterialTheme.typography.bodyLarge,
                fontWeight = FontWeight.Bold,
                color = DoneInk,
            )
            val way = listOfNotNull(copy.rideName(ride), rideDirection(ride))
            Text(text = way.joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = DoneLabel)
        }
        val departs = ride.departureAt
        val arrives = ride.arrivalAt
        if (departs != null && arrives != null) {
            Text(
                text = "${formatClock(departs)}–${formatClock(arrives)}",
                style = MaterialTheme.typography.bodySmall.merge(fontFeatureSettings = "tnum"),
                color = DoneLabel,
            )
        }
    }
}

private const val DRAW_IN_MILLIS = 1100
