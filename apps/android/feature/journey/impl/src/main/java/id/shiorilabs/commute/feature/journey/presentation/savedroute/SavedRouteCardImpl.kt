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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
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
import id.shiorilabs.commute.core.type.Failure
import id.shiorilabs.commute.core.type.UIState
import id.shiorilabs.commute.core.type.toFailure
import id.shiorilabs.commute.core.ui.components.LineRoundel
import id.shiorilabs.commute.core.ui.components.ProblemPanel
import id.shiorilabs.commute.core.ui.components.RoundelSize
import id.shiorilabs.commute.core.ui.components.SkeletonBlock
import id.shiorilabs.commute.core.ui.ext.parseHexColor
import id.shiorilabs.commute.core.ui.ext.tint
import id.shiorilabs.commute.core.ui.preview.CommutePreviewScaffold
import id.shiorilabs.commute.core.ui.startup.HoldStartupWhile
import id.shiorilabs.commute.core.ui.theme.Amber700
import id.shiorilabs.commute.core.ui.theme.Slate400
import id.shiorilabs.commute.core.ui.theme.Slate500
import id.shiorilabs.commute.core.ui.time.rememberJakartaNow
import id.shiorilabs.commute.feature.journey.R
import id.shiorilabs.commute.feature.journey.domain.JAKARTA
import id.shiorilabs.commute.feature.journey.domain.Journey
import id.shiorilabs.commute.feature.journey.domain.JourneyStop
import id.shiorilabs.commute.feature.journey.domain.TripAnswer
import id.shiorilabs.commute.feature.journey.domain.boardsAt
import id.shiorilabs.commute.feature.journey.domain.formatClock
import id.shiorilabs.commute.feature.journey.domain.formatDuration
import id.shiorilabs.commute.feature.journey.domain.formatRupiah
import id.shiorilabs.commute.feature.journey.domain.isLastTrain
import id.shiorilabs.commute.feature.journey.domain.resumeTimeOf
import id.shiorilabs.commute.feature.journey.domain.rides
import id.shiorilabs.commute.feature.journey.domain.upcomingJourneys
import id.shiorilabs.commute.feature.journey.presentation.SavedRouteCard
import id.shiorilabs.commute.feature.journey.presentation.trip.tripRoute
import id.shiorilabs.commute.feature.station.domain.LineInfo
import id.shiorilabs.commute.feature.station.domain.codeOfLineKey
import java.time.Instant
import javax.inject.Inject

/** The colour of a line the dictionary doesn't know yet, the web's `LINE_COLOR_FALLBACK`. */
private val FallbackLineColor = Color(0xFF94A3B8)

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
            onOpen = { journey ->
                // The trip page asks with the card's own criteria, so lands on the card's answer.
                val criteria = state.criteria
                navigator.goTo(
                    if (journey != null && criteria != null) {
                        tripRoute(fromId, toId, journey, criteria)
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
    onOpen: (Journey?) -> Unit,
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
                if (answer.cause?.toFailure() is Failure.Network) R.string.journey_saved_route_offline else R.string.journey_saved_route_failed,
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
    onOpen: (Journey?) -> Unit,
    modifier: Modifier = Modifier,
) {
    val rows = upcomingJourneys(answer.journeys, now)
    // Coloured by the soonest row, or once the night is over by the route that starts again, so an
    // ended card keeps its line's colour instead of greying.
    val lead = rows.firstOrNull() ?: answer.journeys.firstOrNull { it.resumesAt != null }
    val lineColor = lead?.rides?.firstOrNull()?.let { lines[it.line] }?.let { parseHexColor(it.colorCode) } ?: FallbackLineColor
    val divider = lineColor.tint(0.3f)
    val shape = MaterialTheme.shapes.medium
    val description = stringResource(R.string.journey_saved_route_rows_description, answer.from.name, answer.to.name)

    Column(
        modifier = modifier
            .fillMaxWidth()
            .shadow(8.dp, shape)
            .clip(shape)
            .background(lineColor.tint(0.065f))
            .semantics { contentDescription = description },
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
            rows.forEachIndexed { index, journey ->
                if (index > 0) {
                    HorizontalDivider(color = divider)
                }
                JourneyRow(journey, lines, onClick = { onOpen(journey) })
            }
        }
    }
}

/** The web's "transit Nx" counts walk transfers only, so a same-platform change is no transit. */
@Composable
private fun changeLabel(journey: Journey): String = when {
    journey.transferCount > 0 -> stringResource(R.string.journey_transfer_count, journey.transferCount)
    journey.boardings > 1 -> stringResource(R.string.journey_saved_route_change_train)
    else -> stringResource(R.string.journey_saved_route_direct)
}

@Composable
private fun JourneyRow(journey: Journey, lines: Map<String, LineInfo>, onClick: () -> Unit) {
    val rides = journey.rides
    val boardsAt = journey.boardsAt
    val arrivesAt = journey.arrivalAt
    val headsign = rides.firstOrNull()?.headsign
    val lastTrain = stringResource(R.string.journey_last_train)
    val change = changeLabel(journey)
    val towards = headsign?.let { stringResource(R.string.journey_headsign, it) }

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(role = Role.Button, onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            rides.forEach { ride ->
                val info = lines[ride.line]
                LineRoundel(
                    code = info?.lineCode ?: codeOfLineKey(ride.line),
                    color = info?.colorCode ?: "#94A3B8",
                    operator = ride.operator,
                    size = RoundelSize.SM,
                )
            }
        }
        Column(modifier = Modifier.weight(1f)) {
            if (boardsAt != null) {
                Text(
                    text = buildAnnotatedString {
                        append(formatClock(boardsAt))
                        if (arrivesAt != null) {
                            withStyle(SpanStyle(color = Slate400, fontWeight = FontWeight.SemiBold)) { append(" → ") }
                            append(formatClock(arrivesAt))
                        }
                    },
                    style = MaterialTheme.typography.titleMedium.copy(fontSize = 18.sp),
                    fontWeight = FontWeight.Bold,
                    maxLines = 1,
                )
            } else {
                Text(
                    text = towards?.let { stringResource(R.string.journey_saved_route_towards, headsign) }
                        ?: stringResource(R.string.journey_saved_route_untimed),
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = FontWeight.Bold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Text(
                text = buildAnnotatedString {
                    if (journey.isLastTrain) {
                        withStyle(SpanStyle(color = Amber700)) { append("$lastTrain · ") }
                    }
                    append(change)
                    if (boardsAt != null && towards != null) {
                        append(" · $towards")
                    }
                },
                style = MaterialTheme.typography.bodySmall,
                fontWeight = FontWeight.SemiBold,
                color = Slate500,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        Column(horizontalAlignment = Alignment.End) {
            if (boardsAt != null && arrivesAt != null) {
                Text(
                    text = formatDuration(boardsAt, arrivesAt),
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.Bold,
                )
            }
            journey.totalFare?.let { fare ->
                Text(
                    text = formatRupiah(fare),
                    style = MaterialTheme.typography.bodySmall,
                    fontWeight = FontWeight.SemiBold,
                    color = Slate500,
                )
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
