package id.shiorilabs.commute.feature.trip.presentation

import androidx.compose.foundation.Canvas
import id.shiorilabs.commute.feature.station.domain.formatPlatformCode
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.draw.rotate
import androidx.compose.runtime.setValue
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
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
import kotlinx.coroutines.delay
import java.time.Instant
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import id.shiorilabs.commute.core.navigation.LocalNavigator
import id.shiorilabs.commute.core.navigation.Route
import id.shiorilabs.commute.core.trip.TripStop
import id.shiorilabs.commute.core.trip.scheduledAtStop
import id.shiorilabs.commute.core.trip.seenAt
import id.shiorilabs.commute.core.trip.PositionSource
import id.shiorilabs.commute.core.trip.RiderAction
import id.shiorilabs.commute.core.trip.TripLeg
import id.shiorilabs.commute.core.trip.TripPhase
import id.shiorilabs.commute.core.trip.progress
import id.shiorilabs.commute.core.ui.components.CommuteCloseButton
import id.shiorilabs.commute.core.ui.components.LineRoundel
import id.shiorilabs.commute.core.ui.components.NoticeBanner
import id.shiorilabs.commute.core.ui.components.CommuteButton
import id.shiorilabs.commute.core.ui.components.CommuteButtonVariant
import id.shiorilabs.commute.core.ui.components.SectionLabel
import id.shiorilabs.commute.core.ui.icons.CommuteIcons
import id.shiorilabs.commute.core.ui.ext.lineColorOf
import id.shiorilabs.commute.core.ui.theme.Slate100
import id.shiorilabs.commute.core.ui.theme.Slate300
import id.shiorilabs.commute.core.ui.theme.Slate400
import id.shiorilabs.commute.core.ui.theme.Slate500
import id.shiorilabs.commute.core.ui.theme.Slate900
import id.shiorilabs.commute.feature.station.domain.LineInfo
import id.shiorilabs.commute.feature.trip.ActiveTrip
import id.shiorilabs.commute.feature.trip.TripReminder
import id.shiorilabs.commute.feature.trip.R
import kotlin.math.roundToInt

/**
 * The trip being followed, live: what to do next, how the position is known, and every stop of
 * every ride marked passed, here or ahead. Reads the stored trip, so it works offline.
 */
@Composable
fun ActiveTripScreen(innerPadding: PaddingValues, viewModel: ActiveTripViewModel = hiltViewModel()) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val manualMarks by viewModel.manualMarks.collectAsStateWithLifecycle()
    val boardPages by viewModel.boardPages.collectAsStateWithLifecycle()
    val navigator = LocalNavigator.current

    ActiveTripContent(
        state = state,
        innerPadding = innerPadding,
        onClose = navigator::pop,
        onStop = viewModel::stop,
        onSay = viewModel::say,
        onReminder = viewModel::setReminder,
        onDetails = { trip -> navigator.goTo(trip.origin) },
        onNameHidden = viewModel::onBoardNameHidden,
        onOpenStation = { stop -> navigator.goTo(Route.Station(stop.id, title = stop.name)) },
        onRouteBack = { origin -> navigator.goTo(Route.Otw(fromId = origin.toId, toId = origin.fromId)) },
        manualMarks = manualMarks,
        onMark = viewModel::mark,
        boardPages = boardPages,
    )
}

private val PageBackground = Color.White

/** Ahead of the timetable: the rare train that's early. */
private val OnTimeGreen = Color(0xFF059669)

@Composable
private fun ActiveTripContent(
    state: ActiveTripUiState,
    innerPadding: PaddingValues,
    onClose: () -> Unit,
    onStop: () -> Unit,
    onSay: (RiderAction) -> Unit,
    onReminder: (TripReminder) -> Unit,
    onDetails: (ActiveTrip) -> Unit,
    onNameHidden: (Boolean) -> Unit,
    onOpenStation: (TripStop) -> Unit,
    onRouteBack: (Route.Trip) -> Unit,
    manualMarks: Boolean = false,
    onMark: (MarkKind, Pids) -> Unit = { _, _ -> },
    boardPages: Boolean = false,
) {
    val trip = state.trip
    val marking = manualMarks && trip != null
    val context = LocalContext.current
    val copy = remember(context, state.lines) { TripCopy(context.resources, state.lines) }
    // The board's minutes count down between the trip's own updates.
    val now by produceState(Instant.now()) {
        while (true) {
            delay(CLOCK_TICK_MILLIS)
            value = Instant.now()
        }
    }

    // The app's trip bar, over the page, folds the big name into itself once the name has
    // scrolled up under it: past the list's top edge, where the bar ends.
    var listTop by remember { mutableFloatStateOf(0f) }
    var nameBottom by remember { mutableFloatStateOf(Float.POSITIVE_INFINITY) }
    val nameHidden by remember { derivedStateOf { nameBottom <= listTop } }
    LaunchedEffect(nameHidden) { onNameHidden(nameHidden) }
    DisposableEffect(Unit) { onDispose { onNameHidden(false) } }

    Box(modifier = Modifier.fillMaxSize()) {
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .background(PageBackground)
                .onGloballyPositioned { listTop = it.positionInRoot().y },
            // Clear of the marks' bar, while it's up, as of the system bar.
            contentPadding = PaddingValues(bottom = innerPadding.calculateBottomPadding() + 32.dp + if (marking) MarkBarHeight else 0.dp),
        ) {
            if (trip == null) {
                val finished = state.finished
                if (finished == null) {
                    item(key = "finished") { Finished(innerPadding, onClose) }
                } else {
                    item(key = "done") {
                        TripFinished(
                            finished = finished,
                            lines = state.lines,
                            copy = copy,
                            topInset = innerPadding.calculateTopPadding(),
                            onClose = onClose,
                            onOpenStation = onOpenStation,
                            onRouteBack = { onRouteBack(finished.trip.origin) },
                        )
                    }
                }
                return@LazyColumn
            }
            val pids = trip.pids(now)
            item(key = "board") {
                PidsBoard(
                    pids = pids,
                    lines = state.lines,
                    stationLines = state.stationLines[pids.stationId].orEmpty(),
                    copy = copy,
                    source = copy.source(trip),
                    onNameMoved = { nameBottom = it },
                    pages = boardPages,
                )
            }
            item(key = "actions") {
                Actions(trip, onStop, onSay, modifier = Modifier.padding(start = 32.dp, top = 24.dp, end = 32.dp, bottom = 16.dp))
            }
            if (trip.state.phase != TripPhase.ARRIVED) {
                item(key = "reminder") {
                    ReminderButton(
                        reminder = trip.reminder,
                        onChange = onReminder,
                        modifier = Modifier.padding(start = 32.dp, end = 32.dp, bottom = 24.dp),
                    )
                }
            }
            if (!trip.state.hasLocation) {
                item(key = "no-location") {
                    NoticeBanner(
                        message = stringResource(if (state.tripFixesOff) R.string.trip_live_location_off else R.string.trip_live_no_location),
                        modifier = Modifier.padding(start = 32.dp, end = 32.dp, bottom = 24.dp),
                    )
                }
            }
            item(key = "all-stops") {
                SectionLabel(
                    text = stringResource(R.string.trip_live_all_stops),
                    modifier = Modifier.padding(start = 32.dp, end = 32.dp, bottom = 12.dp),
                )
            }
            val marks = trip.stopMarks()
            trip.plan.legs.forEachIndexed { index, leg ->
                when (leg) {
                    is TripLeg.Ride -> item(key = "ride-$index") {
                        RideBlock(
                            trip = trip,
                            legIndex = index,
                            line = state.lines[leg.line],
                            name = copy.rideName(leg),
                            marks = marks.getValue(index),
                            now = now,
                            modifier = Modifier.padding(start = 32.dp, end = 32.dp, bottom = 16.dp),
                        )
                    }
                    is TripLeg.Transfer -> item(key = "walk-$index") {
                        WalkRow(leg, modifier = Modifier.padding(start = 32.dp, end = 32.dp, bottom = 16.dp))
                    }
                }
            }
            item(key = "details") {
                DetailsRow(onClick = { onDetails(trip) }, modifier = Modifier.padding(start = 32.dp, top = 8.dp, end = 32.dp))
            }
        }
        if (marking) {
            MarkBar(
                bottomInset = innerPadding.calculateBottomPadding(),
                onMark = { kind -> trip?.let { onMark(kind, it.pids(Instant.now())) } },
                modifier = Modifier.align(Alignment.BottomCenter),
            )
        }
    }
}

/** Often enough that "2" turns into "1" about when it should. */
internal const val CLOCK_TICK_MILLIS = 15_000L

/**
 * What the rider can tell the trip: the next step ("Udah naik", "Udah turun") as the pink button
 * when there is one, and stopping as the slate one beside it, as the station page sets its
 * timetable beside "OTW Ke Sini".
 */
@Composable
private fun Actions(trip: ActiveTrip, onStop: () -> Unit, onSay: (RiderAction) -> Unit, modifier: Modifier = Modifier) {
    val ride = trip.plan.ride(trip.state.legIndex)
    val nearEnd = trip.state.phase == TripPhase.RIDING && trip.state.position >= ride.lastIndex - 1
    val next = when {
        trip.state.phase == TripPhase.WAITING_TO_BOARD -> R.string.trip_action_boarded to RiderAction.BOARDED
        nearEnd -> R.string.trip_action_alighted to RiderAction.ALIGHTED
        else -> null
    }
    Row(
        modifier = modifier
            .fillMaxWidth()
            .height(IntrinsicSize.Min),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        next?.let { (text, action) ->
            CommuteButton(
                text = stringResource(text),
                onClick = { onSay(action) },
                modifier = Modifier.weight(1f).fillMaxHeight(),
                leadingIcon = CommuteIcons.Check,
            )
        }
        CommuteButton(
            text = stringResource(R.string.trip_action_stop),
            onClick = onStop,
            modifier = (if (next == null) Modifier.weight(1f) else Modifier).fillMaxHeight(),
            variant = CommuteButtonVariant.Secondary,
            leadingIcon = CommuteIcons.Close,
        )
    }
}

internal val ActionShape = RoundedCornerShape(12.dp)

/**
 * One ride as a timeline in the board's terms: the line thick in its colour and grey behind the
 * rider, the rider as the board's pink chevron (or a pink dot at a stop), the stop they're making
 * for yellow, each stop's time down the right, and on a long ride the stops that don't matter yet
 * folded into one line.
 */
@Composable
private fun RideBlock(
    trip: ActiveTrip,
    legIndex: Int,
    line: LineInfo?,
    name: String,
    marks: RideMarks,
    now: Instant,
    modifier: Modifier = Modifier,
) {
    val ride = trip.plan.ride(legIndex)
    val color = lineColorOf(line?.colorCode)
    val current = legIndex == trip.state.legIndex && trip.state.phase != TripPhase.ARRIVED
    val here = marks.marks.indexOf(StopMark.HERE).takeIf { it >= 0 }
    // The stop the board names: the next one riding; boarding while waiting, unless the rider is
    // seen there already and it's theirs as "Kamu di sini".
    val next = when {
        !current -> null
        trip.state.phase == TripPhase.RIDING -> marks.marks.indexOf(StopMark.UPCOMING).takeIf { it >= 0 }
        here == null -> 0
        else -> null
    }
    var expanded by rememberSaveable { mutableStateOf(false) }
    val rows = timelineRows(ride.stops.size, focus = if (current) here ?: marks.betweenAfter ?: next else null, expanded = expanded)

    Column(modifier = modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.padding(bottom = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            LineRoundel(code = line?.lineCode ?: ride.line.substringAfter(':'), color = line?.colorCode ?: "#94A3B8", operator = ride.operator)
            Column(modifier = Modifier.weight(1f)) {
                Text(text = name, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
                ride.headsign?.let {
                    Text(text = stringResource(R.string.trip_headsign, it), style = MaterialTheme.typography.bodySmall, color = Slate500)
                }
            }
            ride.platformCode?.let {
                Text(
                    text = stringResource(R.string.trip_platform, formatPlatformCode(it)),
                    style = MaterialTheme.typography.labelLarge,
                    color = Slate500,
                )
            }
        }
        rows.forEach { row ->
            when (row) {
                is TimelineRow.Stop -> {
                    val i = row.index
                    StopRow(
                        name = ride.stops[i].name,
                        mark = marks.marks[i],
                        next = i == next,
                        scheduled = trip.plan.scheduledAtStop(legIndex, i),
                        // Seen there, or still to come: a stop passed unseen keeps its timetable.
                        at = trip.state.seenAt(legIndex, i)
                            ?: trip.expectedAtStop(legIndex, i, now).takeIf { marks.marks[i] != StopMark.PASSED },
                        color = color,
                        first = i == 0,
                        last = i == ride.lastIndex,
                        topReached = i > 0 && marks.marks[i].reached,
                        bottomReached = i < ride.lastIndex && (marks.marks[i + 1].reached || marks.betweenAfter == i),
                    )
                    if (marks.betweenAfter == i) OnTheWayRow(next = ride.stops[i + 1].name, color = color)
                }
                is TimelineRow.Folded -> FoldedRow(
                    text = stringResource(if (ride.isBus) R.string.trip_live_more_haltes else R.string.trip_live_more_stations, row.count),
                    color = if (marks.marks[row.last].reached) Slate300 else color,
                    onClick = { expanded = true },
                )
            }
        }
    }
}

@Composable
private fun StopRow(
    name: String,
    mark: StopMark,
    next: Boolean,
    scheduled: Instant?,
    at: Instant?,
    color: Color,
    first: Boolean,
    last: Boolean,
    topReached: Boolean,
    bottomReached: Boolean,
) {
    val passed = mark == StopMark.PASSED
    val alighting = last && !passed && mark != StopMark.HERE
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(IntrinsicSize.Min)
            .semantics(mergeDescendants = true) {},
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Rail(
            top = if (first) null else if (topReached) Slate300 else color,
            bottom = if (last) null else if (bottomReached) Slate300 else color,
        ) {
            when {
                mark == StopMark.HERE -> Dot(16.dp, fill = MaterialTheme.colorScheme.primary, ring = PageBackground)
                next -> Dot(16.dp, fill = NextStopYellow, ring = PageBackground)
                passed -> Dot(10.dp, fill = PageBackground, ring = Slate300)
                last -> Dot(14.dp, fill = PageBackground, ring = color, ringWidth = 4.dp)
                else -> Dot(10.dp, fill = PageBackground, ring = color)
            }
        }
        Column(modifier = Modifier.weight(1f).padding(vertical = 8.dp)) {
            Text(
                text = name,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = if (first || last || next || mark == StopMark.HERE) FontWeight.Bold else FontWeight.Normal,
                color = if (passed) Slate400 else Slate900,
            )
            val label = when {
                mark == StopMark.HERE -> R.string.trip_live_you_are_here
                next -> R.string.trip_pids_next
                first && !passed -> R.string.trip_live_board_here
                else -> null
            }
            label?.let { Text(text = stringResource(it), style = MaterialTheme.typography.labelSmall, color = Slate500) }
            if (alighting) {
                val description = stringResource(R.string.trip_live_alight_here)
                Text(
                    text = stringResource(R.string.trip_pids_get_off),
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
        TimetableTime(
            scheduled = scheduled,
            actual = at,
            style = MaterialTheme.typography.labelLarge.merge(
                fontFeatureSettings = "tnum",
                fontWeight = if (next) FontWeight.Bold else FontWeight.Normal,
            ),
            color = when {
                passed -> Slate400
                next -> Slate900
                else -> Slate500
            },
            struck = Slate400,
            late = MaterialTheme.colorScheme.primary,
            early = OnTimeGreen,
            modifier = Modifier.padding(start = 12.dp),
        )
    }
}

/** The rider out between two stops: the board's pink chevron on the line, heading down it. */
@Composable
private fun OnTheWayRow(next: String, color: Color) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(IntrinsicSize.Min),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Rail(top = Slate300, bottom = color) { RiderChevron() }
        Text(
            text = stringResource(R.string.trip_live_on_the_way, next),
            modifier = Modifier.padding(vertical = 6.dp),
            style = MaterialTheme.typography.labelMedium,
            fontWeight = FontWeight.Bold,
            color = Slate900,
        )
    }
}

/** Stops folded away on a long ride, the line dotted past them; tapping opens the whole ride. */
@Composable
private fun FoldedRow(text: String, color: Color, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(IntrinsicSize.Min)
            .clip(RoundedCornerShape(8.dp))
            .clickable(role = Role.Button, onClick = onClick),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(modifier = Modifier.width(RailWidth).fillMaxHeight(), contentAlignment = Alignment.Center) {
            Canvas(modifier = Modifier.width(LineWidth).fillMaxHeight()) {
                drawLine(
                    color = color,
                    start = Offset(size.width / 2, 0f),
                    end = Offset(size.width / 2, size.height),
                    strokeWidth = size.width,
                    cap = StrokeCap.Round,
                    pathEffect = PathEffect.dashPathEffect(floatArrayOf(0f, size.width * 2), 0f),
                )
            }
        }
        Text(
            text = text,
            modifier = Modifier.padding(vertical = 10.dp),
            style = MaterialTheme.typography.labelMedium,
            fontWeight = FontWeight.Bold,
            color = Slate500,
        )
        Icon(
            imageVector = CommuteIcons.Chevron,
            contentDescription = null,
            modifier = Modifier.padding(start = 4.dp).size(12.dp).rotate(90f),
            tint = Slate500,
        )
    }
}

/** The ride's line down the left, [top] and [bottom] of [node] each coloured, or left out at an end. */
@Composable
private fun Rail(top: Color?, bottom: Color?, node: @Composable () -> Unit) {
    Box(
        modifier = Modifier
            .width(RailWidth)
            .fillMaxHeight(),
        contentAlignment = Alignment.Center,
    ) {
        Column(modifier = Modifier.fillMaxHeight(), horizontalAlignment = Alignment.CenterHorizontally) {
            Box(modifier = Modifier.width(LineWidth).weight(1f).background(top ?: Color.Transparent))
            Box(modifier = Modifier.width(LineWidth).weight(1f).background(bottom ?: Color.Transparent))
        }
        node()
    }
}

@Composable
private fun Dot(size: Dp, fill: Color, ring: Color, ringWidth: Dp = 3.dp) {
    Box(
        modifier = Modifier
            .size(size)
            .clip(CircleShape)
            .background(fill)
            .border(ringWidth, ring, CircleShape),
    )
}

/** The board's marker, pink edged in white, pointing down the line. */
@Composable
private fun RiderChevron() {
    val pink = MaterialTheme.colorScheme.primary
    Canvas(modifier = Modifier.size(22.dp)) {
        val s = size.minDimension * 0.3f
        val c = center
        val chevron = Path().apply {
            moveTo(c.x - s, c.y - s * 0.6f)
            lineTo(c.x, c.y + s * 0.6f)
            lineTo(c.x + s, c.y - s * 0.6f)
        }
        drawPath(chevron, PageBackground, style = Stroke(width = s * 1.1f, cap = StrokeCap.Round, join = StrokeJoin.Round))
        drawPath(chevron, pink, style = Stroke(width = s * 0.6f, cap = StrokeCap.Round, join = StrokeJoin.Round))
    }
}

/** The way to the journey's own page, as a row like the app's other links. */
@Composable
private fun DetailsRow(onClick: () -> Unit, modifier: Modifier = Modifier) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .clip(ActionShape)
            .background(Slate100)
            .clickable(role = Role.Button, onClick = onClick)
            .padding(16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = stringResource(R.string.trip_live_details),
            modifier = Modifier.weight(1f),
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.Bold,
            color = Slate900,
        )
        Icon(imageVector = CommuteIcons.Chevron, contentDescription = null, modifier = Modifier.size(16.dp), tint = Slate400)
    }
}

/** The timeline's column for the line, and the line's own width: the board's band, laid flat. */
private val RailWidth = 32.dp
private val LineWidth = 6.dp

/** The board's yellow for the stop it names. */
private val NextStopYellow = Color(0xFFFBBF24)

/**
 * A walk between rides, set on the timeline as the trip details set it: a slate rail under the
 * stops' rails and a quiet line beside it, rather than a plate that reads as a button.
 */
@Composable
private fun WalkRow(walk: TripLeg.Transfer, modifier: Modifier = Modifier) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .height(IntrinsicSize.Min),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Rail(top = Slate300, bottom = Slate300) {}
        Row(
            modifier = Modifier.padding(vertical = 6.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            verticalAlignment = Alignment.Top,
        ) {
            Icon(
                imageVector = CommuteIcons.Walk,
                contentDescription = null,
                modifier = Modifier.padding(top = 2.dp).size(14.dp),
                tint = Slate500,
            )
            Column {
                Text(
                    text = stringResource(R.string.trip_live_walk, walk.distanceM, walk.to.name),
                    style = MaterialTheme.typography.bodyMedium,
                    color = Slate500,
                )
                walk.corridorLabel?.let {
                    Text(text = stringResource(R.string.trip_live_walk_corridor, it), style = MaterialTheme.typography.bodySmall, color = Slate500)
                }
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
            CommuteCloseButton(onClick = onClose, contentDescription = stringResource(R.string.trip_live_close))
        }
        Text(
            text = stringResource(R.string.trip_live_finished_detail),
            modifier = Modifier.padding(top = 8.dp),
            style = MaterialTheme.typography.bodyMedium,
            color = Slate500,
        )
    }
}
