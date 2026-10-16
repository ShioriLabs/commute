package id.shiorilabs.commute.feature.journey.presentation.savedroute

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import id.shiorilabs.commute.core.navigation.LocalNavigator
import id.shiorilabs.commute.core.navigation.Route
import id.shiorilabs.commute.core.time.formatClock
import id.shiorilabs.commute.core.type.UIState
import id.shiorilabs.commute.core.type.isOffline
import id.shiorilabs.commute.core.ui.components.CommuteCard
import id.shiorilabs.commute.core.ui.components.LineRoundel
import id.shiorilabs.commute.core.ui.components.ProblemPanel
import id.shiorilabs.commute.core.ui.components.RoundelSize
import id.shiorilabs.commute.core.ui.components.SkeletonBlock
import id.shiorilabs.commute.feature.journey.domain.RouteBarSegment
import id.shiorilabs.commute.feature.journey.domain.routeBarSegments
import id.shiorilabs.commute.feature.journey.presentation.components.WalkChip
import id.shiorilabs.commute.feature.journey.presentation.components.legLines
import id.shiorilabs.commute.core.ui.ext.lineColorOf
import id.shiorilabs.commute.core.ui.ext.themedTint
import id.shiorilabs.commute.core.ui.preview.CommutePreviewScaffold
import id.shiorilabs.commute.core.ui.startup.HoldStartupWhile
import id.shiorilabs.commute.core.ui.theme.Amber700
import id.shiorilabs.commute.core.ui.theme.Slate400
import id.shiorilabs.commute.core.ui.theme.Slate500
import id.shiorilabs.commute.core.ui.time.rememberJakartaNow
import id.shiorilabs.commute.feature.journey.R
import id.shiorilabs.commute.core.time.JAKARTA
import id.shiorilabs.commute.feature.journey.domain.Journey
import id.shiorilabs.commute.feature.journey.domain.NEXT_DEPARTURES_SHOWN
import id.shiorilabs.commute.feature.journey.domain.JourneyStop
import id.shiorilabs.commute.feature.journey.domain.TripAnswer
import id.shiorilabs.commute.feature.journey.domain.UpcomingRow
import id.shiorilabs.commute.feature.journey.domain.boardsAtOf
import id.shiorilabs.commute.feature.journey.domain.formatDuration
import id.shiorilabs.commute.feature.journey.domain.formatRupiah
import id.shiorilabs.commute.feature.journey.domain.isLastTrain
import id.shiorilabs.commute.feature.journey.domain.resumeTimeOf
import id.shiorilabs.commute.feature.journey.domain.rides
import id.shiorilabs.commute.feature.journey.domain.upcomingJourneys
import id.shiorilabs.commute.feature.journey.presentation.SavedRouteCard
import id.shiorilabs.commute.feature.journey.presentation.trip.tripRoute
import id.shiorilabs.commute.feature.station.domain.LineInfo
import java.time.Instant
import javax.inject.Inject

/**
 * The web's `SavedRouteCard`: a saved pair's next boardings, dressed like a station's line card
 * (heavy top rule, tinted body) so the two read as one feed, in the colour of the line the soonest
 * row boards on. Each row opens that train's trip page; with none left, the card opens the pair in
 * search's OTW tab.
 */
class SavedRouteCardImpl @Inject constructor() : SavedRouteCard {

    @Composable
    override fun Content(fromId: String, toId: String, modifier: Modifier) {
        val viewModel = hiltViewModel<SavedRouteViewModel, SavedRouteViewModel.Factory>(
            key = "route:$fromId>$toId",
            creationCallback = { factory -> factory.create(fromId, toId) },
        )
        val state by viewModel.state.collectAsStateWithLifecycle()
        // With home's feed, the splash waits for this card's rows rather than reveal its skeleton.
        HoldStartupWhile(waiting = state.answer is UIState.Loading)
        val navigator = LocalNavigator.current
        val now = rememberJakartaNow().atZone(JAKARTA).toInstant()

        LaunchedEffect(now) {
            viewModel.onClockTick(now)
        }
        LifecycleResumeEffect(viewModel) {
            viewModel.onClockTick(Instant.now())
            onPauseOrDispose { }
        }

        SavedRouteCardContent(
            state = state,
            now = now,
            onOpen = { row ->
                // The trip page asks with the card's own criteria, so lands on the card's answer.
                val criteria = state.criteria
                navigator.goTo(
                    if (row != null && criteria != null) {
                        tripRoute(fromId, toId, row.journey, criteria, row.departures.firstOrNull()?.departureAt ?: boardsAtOf(row.journey))
                    } else {
                        Route.Otw(fromId = fromId, toId = toId)
                    },
                )
            },
            onRetry = viewModel::retry,
            modifier = modifier,
        )
    }
}

@Composable
private fun SavedRouteCardContent(
    state: SavedRouteUiState,
    now: Instant,
    onOpen: (UpcomingRow?) -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val inset = modifier.padding(horizontal = 16.dp)
    when (val answer = state.answer) {
        is UIState.Idle, is UIState.Loading -> SkeletonBlock(
            modifier = inset
                .fillMaxWidth()
                .height(200.dp),
        )

        is UIState.Error -> ProblemPanel(
            message = stringResource(
                if (answer.isOffline()) R.string.journey_saved_route_offline else R.string.journey_saved_route_failed,
            ),
            retryLabel = stringResource(R.string.journey_saved_route_retry),
            onRetry = onRetry,
            modifier = inset,
        )

        is UIState.Success -> RouteBoard(answer.data, state.lines, now, onOpen, inset)
    }
}

@Composable
private fun RouteBoard(
    answer: TripAnswer,
    lines: Map<String, LineInfo>,
    now: Instant,
    onOpen: (UpcomingRow?) -> Unit,
    modifier: Modifier = Modifier,
) {
    val rows = upcomingJourneys(answer.journeys, now)
    // Coloured by the soonest row, or once the night is over by the route that starts again, so an
    // ended card keeps its line's colour instead of greying.
    val lead = rows.firstOrNull()?.journey ?: answer.journeys.firstOrNull { it.resumesAt != null }
    val lineColor = lineColorOf(lead?.rides?.firstOrNull()?.let { lines[it.line] }?.colorCode)
    val divider = lineColor.themedTint(0.3f)
    val description = stringResource(R.string.journey_saved_route_rows_description, answer.from.name, answer.to.name)

    CommuteCard(
        color = lineColor.themedTint(0.065f),
        modifier = modifier.semantics { contentDescription = description },
    ) {
        Box(
            Modifier
                .fillMaxWidth()
                .height(16.dp)
                .background(lineColor),
        )
        if (rows.isEmpty()) {
            Ended(resumesAt = resumeTimeOf(answer.journeys), onClick = { onOpen(null) })
        } else {
            rows.forEachIndexed { index, row ->
                if (index > 0) {
                    HorizontalDivider(color = divider)
                }
                JourneyRow(row, lines, onClick = { onOpen(row) })
            }
        }
    }
}

/**
 * One boarding as the web's saved-route row draws it: the route as roundels and walk chips, then the
 * clock beside its duration, then what comes next beside the fare. No change count or headsign: the
 * roundels already say how many vehicles and which lines, and the row is about when.
 */
@Composable
private fun JourneyRow(row: UpcomingRow, lines: Map<String, LineInfo>, onClick: () -> Unit) {
    val journey = row.journey
    // The soonest train still to come: the route's own unless it left while the answer was held.
    val lead = row.departures.firstOrNull()
    val boardsAt = lead?.departureAt
    val arrivesAt = lead?.arrivalAt
    val next = row.departures.drop(1).take(NEXT_DEPARTURES_SHOWN)
    val headsign = journey.rides.firstOrNull()?.headsign
    val segments = routeBarSegments(journey.legs) { legLines(it, lines) }
    val duration = if (boardsAt != null && arrivesAt != null) formatDuration(boardsAt, arrivesAt).ifEmpty { null } else null
    val fare = journey.totalFare?.let(::formatRupiah)
    // Untimed rows have no duration, so the fare moves up to the headline's line.
    val headlineFigure = duration ?: fare
    val secondFigure = if (duration != null) fare else null
    // The last train has nothing after it, so it and later trains share one line, and it wins.
    val secondLine = when {
        journey.isLastTrain -> stringResource(R.string.journey_last_train) to true
        next.isNotEmpty() -> stringResource(R.string.journey_next_departures, next.joinToString(", ") { formatClock(it.departureAt) }) to false
        else -> null
    }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(role = Role.Button, onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 12.dp),
    ) {
        Row(
            modifier = Modifier.padding(bottom = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            segments.forEach { segment ->
                when (segment) {
                    is RouteBarSegment.Walk -> WalkChip(segment.distanceM)
                    is RouteBarSegment.Ride -> LineRoundel(
                        code = segment.code,
                        color = segment.colors.first(),
                        operator = segment.operator,
                        size = RoundelSize.SM,
                    )
                }
            }
        }
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.Bottom,
        ) {
            if (boardsAt != null) {
                Text(
                    text = buildAnnotatedString {
                        append(formatClock(boardsAt))
                        if (arrivesAt != null) {
                            withStyle(SpanStyle(color = Slate400, fontWeight = FontWeight.SemiBold)) { append(" → ") }
                            append(formatClock(arrivesAt))
                        }
                    },
                    modifier = Modifier.weight(1f),
                    style = MaterialTheme.typography.titleMedium.copy(fontSize = 18.sp),
                    fontWeight = FontWeight.Bold,
                    maxLines = 1,
                )
            } else {
                Text(
                    text = headsign?.let { stringResource(R.string.journey_saved_route_towards, it) }
                        ?: stringResource(R.string.journey_saved_route_untimed),
                    modifier = Modifier.weight(1f),
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = FontWeight.Bold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            headlineFigure?.let {
                Text(
                    text = it,
                    style = if (duration != null) MaterialTheme.typography.bodyMedium else MaterialTheme.typography.bodySmall,
                    fontWeight = if (duration != null) FontWeight.Bold else FontWeight.SemiBold,
                    color = if (duration != null) Color.Unspecified else Slate500,
                )
            }
        }
        if (secondLine != null || secondFigure != null) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.Top,
            ) {
                Text(
                    text = secondLine?.first.orEmpty(),
                    modifier = Modifier.weight(1f),
                    style = MaterialTheme.typography.bodySmall,
                    fontWeight = FontWeight.SemiBold,
                    color = if (secondLine?.second == true) Amber700 else Slate500,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                secondFigure?.let {
                    Text(text = it, style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.SemiBold, color = Slate500)
                }
            }
        }
    }
}

/** Nothing left tonight: the same words as a station's line card whose service is over. */
@Composable
private fun Ended(resumesAt: Instant?, onClick: () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(role = Role.Button, onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 12.dp),
    ) {
        Text(
            text = stringResource(R.string.journey_saved_route_over),
            style = MaterialTheme.typography.titleMedium.copy(fontSize = 18.sp),
            fontWeight = FontWeight.Bold,
            color = Slate500,
        )
        Text(
            text = resumesAt?.let { stringResource(R.string.journey_saved_route_restarts, formatClock(it)) }
                ?: stringResource(R.string.journey_saved_route_none_left),
            style = MaterialTheme.typography.bodySmall,
            fontWeight = FontWeight.SemiBold,
            color = Slate500,
        )
    }
}

@Preview(showBackground = true)
@Composable
private fun SavedRouteEndedPreview() {
    CommutePreviewScaffold {
        SavedRouteCardContent(
            state = SavedRouteUiState(
                answer = UIState.Success(TripAnswer(JourneyStop("KCI-SUD", "Sudirman"), JourneyStop("KCI-BOO", "Bogor"), emptyList())),
            ),
            now = Instant.parse("2026-10-01T17:00:00Z"),
            onOpen = {},
            onRetry = {},
            modifier = Modifier.padding(vertical = 16.dp),
        )
    }
}
