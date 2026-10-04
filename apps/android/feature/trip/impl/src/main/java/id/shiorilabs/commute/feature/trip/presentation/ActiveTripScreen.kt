package id.shiorilabs.commute.feature.trip.presentation

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import java.time.Instant
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import id.shiorilabs.commute.core.navigation.LocalNavigator
import id.shiorilabs.commute.core.trip.PositionSource
import id.shiorilabs.commute.core.trip.RiderAction
import id.shiorilabs.commute.core.trip.TripLeg
import id.shiorilabs.commute.core.trip.TripPhase
import id.shiorilabs.commute.core.trip.progress
import id.shiorilabs.commute.core.ui.components.CommuteIconButton
import id.shiorilabs.commute.core.ui.components.LineRoundel
import id.shiorilabs.commute.core.ui.components.NoticeBanner
import id.shiorilabs.commute.core.ui.ext.parseHexColor
import id.shiorilabs.commute.core.ui.icons.CommuteIcons
import id.shiorilabs.commute.feature.station.domain.LineInfo
import id.shiorilabs.commute.feature.trip.ActiveTrip
import id.shiorilabs.commute.feature.trip.R
import kotlin.math.roundToInt

/**
 * The trip being followed, live: what to do next, how the position is known, and every stop of
 * every ride marked passed, here or ahead. Reads the stored trip, so it works offline.
 */
@Composable
fun ActiveTripScreen(innerPadding: PaddingValues, viewModel: ActiveTripViewModel = hiltViewModel()) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val navigator = LocalNavigator.current

    ActiveTripContent(
        state = state,
        innerPadding = innerPadding,
        onClose = navigator::pop,
        onStop = viewModel::stop,
        onSay = viewModel::say,
        onDetails = { trip -> navigator.goTo(trip.origin) },
    )
}

private val PageBackground = Color.White
private val Slate200 = Color(0xFFE2E8F0)
private val Slate300 = Color(0xFFCBD5E1)
private val Slate400 = Color(0xFF94A3B8)
private val Slate500 = Color(0xFF64748B)
private val Slate900 = Color(0xFF0F172A)

@Composable
private fun ActiveTripContent(
    state: ActiveTripUiState,
    innerPadding: PaddingValues,
    onClose: () -> Unit,
    onStop: () -> Unit,
    onSay: (RiderAction) -> Unit,
    onDetails: (ActiveTrip) -> Unit,
) {
    val trip = state.trip
    val context = LocalContext.current
    val copy = remember(context, state.lines) { TripCopy(context.resources, state.lines) }
    // The board's minutes count down between the trip's own updates.
    val now by produceState(Instant.now()) {
        while (true) {
            delay(CLOCK_TICK_MILLIS)
            value = Instant.now()
        }
    }

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .background(PageBackground),
        contentPadding = PaddingValues(bottom = innerPadding.calculateBottomPadding() + 32.dp),
    ) {
        if (trip == null) {
            item(key = "finished") { Finished(innerPadding, onClose) }
            return@LazyColumn
        }
        item(key = "board") {
            val pids = trip.pids(now)
            PidsBoard(
                pids = pids,
                lines = state.lines,
                stationLines = state.stationLines[pids.stationId].orEmpty(),
                copy = copy,
                source = copy.source(trip),
                topInset = innerPadding.calculateTopPadding(),
                onClose = onClose,
            )
        }
        item(key = "actions") {
            Actions(trip, onStop, onSay, modifier = Modifier.padding(start = 32.dp, top = 24.dp, end = 32.dp, bottom = 24.dp))
        }
        if (!trip.state.hasLocation) {
            item(key = "no-location") {
                NoticeBanner(
                    message = stringResource(R.string.trip_live_no_location),
                    modifier = Modifier.padding(start = 32.dp, end = 32.dp, bottom = 24.dp),
                )
            }
        }
        item(key = "all-stops") {
            Text(
                text = stringResource(R.string.trip_live_all_stops).uppercase(),
                modifier = Modifier.padding(start = 32.dp, end = 32.dp, bottom = 12.dp),
                fontSize = 12.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = 0.5.sp,
                color = Slate400,
            )
        }
        val marks = trip.stopMarks()
        trip.plan.legs.forEachIndexed { index, leg ->
            when (leg) {
                is TripLeg.Ride -> item(key = "ride-$index") {
                    RideBlock(
                        ride = leg,
                        line = state.lines[leg.line],
                        name = copy.rideName(leg),
                        marks = marks.getValue(index),
                        modifier = Modifier.padding(start = 32.dp, end = 32.dp, bottom = 16.dp),
                    )
                }
                is TripLeg.Transfer -> item(key = "walk-$index") {
                    WalkRow(leg, modifier = Modifier.padding(start = 32.dp, end = 32.dp, bottom = 16.dp))
                }
            }
        }
        item(key = "details") {
            Text(
                text = stringResource(R.string.trip_live_details),
                modifier = Modifier
                    .padding(start = 32.dp, top = 8.dp, end = 32.dp)
                    .clip(RoundedCornerShape(8.dp))
                    .clickable(role = Role.Button) { onDetails(trip) }
                    .padding(vertical = 8.dp),
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.primary,
            )
        }
    }
}

/** Often enough that "2" turns into "1" about when it should. */
private const val CLOCK_TICK_MILLIS = 15_000L

@Composable
private fun Actions(trip: ActiveTrip, onStop: () -> Unit, onSay: (RiderAction) -> Unit, modifier: Modifier = Modifier) {
    val ride = trip.plan.ride(trip.state.legIndex)
    val nearEnd = trip.state.phase == TripPhase.RIDING && trip.state.position >= ride.lastIndex - 1
    Row(
        modifier = modifier
            .fillMaxWidth()
            .height(IntrinsicSize.Min),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        when {
            trip.state.phase == TripPhase.WAITING_TO_BOARD ->
                ActionButton(stringResource(R.string.trip_action_boarded), CommuteIcons.Check) { onSay(RiderAction.BOARDED) }
            nearEnd ->
                ActionButton(stringResource(R.string.trip_action_alighted), CommuteIcons.Check) { onSay(RiderAction.ALIGHTED) }
        }
        ActionButton(stringResource(R.string.trip_action_stop), CommuteIcons.Close, onClick = onStop)
    }
}

@Composable
private fun RowScope.ActionButton(text: String, icon: ImageVector, onClick: () -> Unit) {
    val content = MaterialTheme.colorScheme.primary
    Row(
        modifier = Modifier
            .weight(1f)
            .fillMaxHeight()
            .clip(RoundedCornerShape(12.dp))
            .background(Slate200)
            .clickable(role = Role.Button, onClick = onClick)
            .padding(16.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(imageVector = icon, contentDescription = null, modifier = Modifier.size(20.dp), tint = content)
        Text(text = text, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Bold, color = content)
    }
}

@Composable
private fun RideBlock(
    ride: TripLeg.Ride,
    line: LineInfo?,
    name: String,
    marks: RideMarks,
    modifier: Modifier = Modifier,
) {
    val color = parseHexColor(line?.colorCode ?: "", Slate400)
    Column(modifier = modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.padding(bottom = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            LineRoundel(code = line?.lineCode ?: ride.line.substringAfter(':'), color = line?.colorCode ?: "#94A3B8", operator = ride.operator)
            Column {
                Text(text = name, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
                ride.headsign?.let {
                    Text(text = stringResource(R.string.trip_headsign, it), style = MaterialTheme.typography.bodySmall, color = Slate500)
                }
            }
        }
        ride.stops.forEachIndexed { i, stop ->
            StopRow(
                name = stop.name,
                mark = marks.marks[i],
                color = color,
                first = i == 0,
                last = i == ride.lastIndex,
            )
            if (marks.betweenAfter == i) OnTheWayRow(next = ride.stops[i + 1].name, color = color)
        }
    }
}

@Composable
private fun StopRow(name: String, mark: StopMark, color: Color, first: Boolean, last: Boolean) {
    val passed = mark == StopMark.PASSED
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(IntrinsicSize.Min),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Rail(color = if (passed) Slate300 else color, top = !first, bottom = !last) {
            val size = if (mark == StopMark.HERE) 16.dp else 10.dp
            Box(
                modifier = Modifier
                    .size(size)
                    .clip(CircleShape)
                    .background(if (mark == StopMark.HERE) Slate900 else PageBackground)
                    .border(3.dp, if (passed) Slate300 else color, CircleShape),
            )
        }
        Column(modifier = Modifier.padding(vertical = 8.dp)) {
            Text(
                text = name,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = if (first || last || mark == StopMark.HERE) FontWeight.Bold else FontWeight.Normal,
                color = if (passed) Slate400 else Slate900,
            )
            val label = when {
                mark == StopMark.HERE -> R.string.trip_live_you_are_here
                last -> R.string.trip_live_alight_here
                first -> R.string.trip_live_board_here
                else -> null
            }
            label?.let { Text(text = stringResource(it), style = MaterialTheme.typography.labelSmall, color = Slate500) }
        }
    }
}

@Composable
private fun OnTheWayRow(next: String, color: Color) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(IntrinsicSize.Min),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Rail(color = color, top = true, bottom = true) {
            Box(modifier = Modifier.size(12.dp).clip(CircleShape).background(Slate900))
        }
        Text(
            text = stringResource(R.string.trip_live_on_the_way, next),
            modifier = Modifier.padding(vertical = 6.dp),
            style = MaterialTheme.typography.labelMedium,
            fontWeight = FontWeight.Bold,
            color = Slate900,
        )
    }
}

/** The ride's line down the left, with [node] on it. */
@Composable
private fun Rail(color: Color, top: Boolean, bottom: Boolean, node: @Composable () -> Unit) {
    Box(
        modifier = Modifier
            .width(32.dp)
            .fillMaxHeight(),
        contentAlignment = Alignment.Center,
    ) {
        Column(modifier = Modifier.fillMaxHeight(), horizontalAlignment = Alignment.CenterHorizontally) {
            Box(modifier = Modifier.width(4.dp).weight(1f).background(if (top) color else Color.Transparent))
            Box(modifier = Modifier.width(4.dp).weight(1f).background(if (bottom) color else Color.Transparent))
        }
        node()
    }
}

@Composable
private fun WalkRow(walk: TripLeg.Transfer, modifier: Modifier = Modifier) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(Slate200.copy(alpha = 0.5f))
            .padding(16.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(imageVector = CommuteIcons.Walk, contentDescription = null, modifier = Modifier.size(20.dp), tint = Slate500)
        Column {
            Text(
                text = stringResource(R.string.trip_live_walk, walk.distanceM, walk.to.name),
                style = MaterialTheme.typography.bodyMedium,
                color = Slate900,
            )
            walk.corridorLabel?.let {
                Text(text = stringResource(R.string.trip_live_walk_corridor, it), style = MaterialTheme.typography.bodySmall, color = Slate500)
            }
        }
    }
}

@Composable
private fun Finished(innerPadding: PaddingValues, onClose: () -> Unit) {
    Column(
        modifier = Modifier
            .padding(top = innerPadding.calculateTopPadding())
            .padding(start = 32.dp, top = 32.dp, end = 32.dp),
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(16.dp), verticalAlignment = Alignment.Top) {
            Text(
                text = stringResource(R.string.trip_live_finished),
                modifier = Modifier
                    .weight(1f)
                    .semantics { heading() },
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.Bold,
            )
            CommuteIconButton(onClick = onClose, modifier = Modifier.size(32.dp)) {
                Icon(
                    imageVector = CommuteIcons.Close,
                    contentDescription = stringResource(R.string.trip_live_close),
                    modifier = Modifier.size(24.dp),
                )
            }
        }
        Text(
            text = stringResource(R.string.trip_live_finished_detail),
            modifier = Modifier.padding(top = 8.dp),
            style = MaterialTheme.typography.bodyMedium,
            color = Slate500,
        )
    }
}
