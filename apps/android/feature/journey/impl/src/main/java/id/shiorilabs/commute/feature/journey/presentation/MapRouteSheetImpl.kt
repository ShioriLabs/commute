package id.shiorilabs.commute.feature.journey.presentation

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import android.content.Intent
import id.shiorilabs.commute.core.navigation.LocalNavigator
import id.shiorilabs.commute.core.navigation.Route
import id.shiorilabs.commute.core.time.JAKARTA
import id.shiorilabs.commute.core.ui.components.CommuteCloseButton
import id.shiorilabs.commute.core.ui.theme.Slate500
import id.shiorilabs.commute.core.ui.time.rememberJakartaNow
import id.shiorilabs.commute.feature.card.api.CardFareCheck
import id.shiorilabs.commute.feature.journey.R
import id.shiorilabs.commute.feature.journey.domain.PairEnd
import id.shiorilabs.commute.feature.journey.domain.formatRupiah
import id.shiorilabs.commute.feature.journey.presentation.components.RecentRoutes
import id.shiorilabs.commute.feature.journey.presentation.components.SaveRoutePlate
import id.shiorilabs.commute.feature.journey.presentation.trip.TripContent
import id.shiorilabs.commute.feature.journey.presentation.trip.TripPageState
import id.shiorilabs.commute.feature.journey.presentation.trip.TripViewModel
import id.shiorilabs.commute.feature.journey.presentation.trip.tripRoute
import javax.inject.Inject

/** Keys the map's planner apart from any other ViewModel on the map's entry. */
private const val MAP_ROUTE_KEY = "map-route"

/**
 * The planner and the trip page in the map's sheet. The planner's ViewModel lives as long as the map
 * does, so folding the sheet away to the chip and back keeps the pair, the settings and the answer.
 */
class MapRouteSheetImpl @Inject constructor(private val cardFareCheck: CardFareCheck) : MapRouteSheet {

    @Composable
    override fun Content(
        fromId: String?,
        toId: String?,
        journey: Route.Trip?,
        onPairChange: (fromId: String?, toId: String?) -> Unit,
        onOpenJourney: (Route.Trip) -> Unit,
        onCloseJourney: () -> Unit,
        onShown: (MapRouteShown) -> Unit,
        onPickOnMap: (PairEnd) -> Unit,
        onTripStarted: () -> Unit,
        onClose: () -> Unit,
        modifier: Modifier,
    ) {
        val viewModel = hiltViewModel<JourneyViewModel, JourneyViewModel.Factory>(
            key = MAP_ROUTE_KEY,
            creationCallback = { factory -> factory.create(Route.Otw(fromId = fromId, toId = toId)) },
        )
        val pairChange by rememberUpdatedState(onPairChange)
        val shown by rememberUpdatedState(onShown)
        LaunchedEffect(viewModel, fromId, toId) { viewModel.setPair(fromId, toId) }
        LaunchedEffect(viewModel) { viewModel.riderPairs.collect { pairChange(it.fromId, it.toId) } }
        LifecycleResumeEffect(viewModel) {
            viewModel.onResume()
            onPauseOrDispose { }
        }
        val state by viewModel.state.collectAsStateWithLifecycle()
        val answeredPair by viewModel.answeredPair.collectAsStateWithLifecycle()

        if (journey == null) {
            // The first option, once the answer on screen is this pair's.
            val first = (state.trip as? TripState.Loaded)?.answer?.journeys?.firstOrNull()?.takeIf { answeredPair == state.pair }
            val reported = MapRouteShown(state.pair.fromId, state.pair.toId, state.origin?.name, state.destination?.name, first)
            LaunchedEffect(reported) { shown(reported) }
            PlannerPage(
                viewModel = viewModel,
                state = state,
                onOpenJourney = onOpenJourney,
                onPickOnMap = onPickOnMap,
                onClose = onClose,
                modifier = modifier,
            )
        } else {
            key(journey) {
                JourneyPage(
                    route = journey,
                    fromName = state.origin?.name,
                    toName = state.destination?.name,
                    onShown = { shown(it) },
                    onBack = onCloseJourney,
                    onTripStarted = onTripStarted,
                    onClose = onClose,
                    modifier = modifier,
                )
            }
        }
    }

    @Composable
    private fun PlannerPage(
        viewModel: JourneyViewModel,
        state: JourneyUiState,
        onOpenJourney: (Route.Trip) -> Unit,
        onPickOnMap: (PairEnd) -> Unit,
        onClose: () -> Unit,
        modifier: Modifier,
    ) {
        val picker by viewModel.picker.collectAsStateWithLifecycle()
        val pickerText by viewModel.pickerText.collectAsStateWithLifecycle()
        val routeSaved by viewModel.routeSaved.collectAsStateWithLifecycle()
        val recentRoutes by viewModel.recentRoutes.collectAsStateWithLifecycle()
        val bottom = WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding() + 32.dp

        Column(modifier = modifier.verticalScroll(rememberScrollState())) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(start = 32.dp, top = 32.dp, end = 32.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = stringResource(R.string.journey_map_sheet_title),
                    modifier = Modifier
                        .weight(1f)
                        .semantics { heading() },
                    style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.Bold,
                )
                CommuteCloseButton(onClick = onClose, contentDescription = stringResource(R.string.journey_map_sheet_close))
            }
            FarePanel(
                state = state,
                picker = picker,
                pickerText = pickerText,
                showEmptyHint = recentRoutes.isEmpty(),
                now = rememberJakartaNow().atZone(JAKARTA).toInstant(),
                actions = viewModel.panelActions(
                    onSelectJourney = { journey ->
                        val fromId = state.pair.fromId
                        val toId = state.pair.toId
                        if (fromId != null && toId != null) onOpenJourney(tripRoute(fromId, toId, journey, state.criteria))
                    },
                    onPickOnMap = onPickOnMap,
                ),
                modifier = Modifier.padding(horizontal = 16.dp),
                footer = {
                    routeSaved?.let { saved ->
                        SaveRoutePlate(saved = saved, onClick = viewModel::onToggleSaveRoute, modifier = Modifier.padding(top = 16.dp))
                    }
                },
            )
            if (state.pair.fromId == null || state.pair.toId == null) {
                RecentRoutes(
                    routes = recentRoutes,
                    onOpen = viewModel::onOpenRecent,
                    onTogglePin = viewModel::onToggleRecentRoute,
                    onClear = viewModel::onClearRecentRoutes,
                    modifier = Modifier.padding(start = 32.dp, top = 24.dp, end = 32.dp),
                )
            }
            Box(Modifier.padding(bottom = bottom))
        }
    }

    @Composable
    private fun JourneyPage(
        route: Route.Trip,
        fromName: String?,
        toName: String?,
        onShown: (MapRouteShown) -> Unit,
        onBack: () -> Unit,
        onTripStarted: () -> Unit,
        onClose: () -> Unit,
        modifier: Modifier,
    ) {
        // One per journey shown, in the map's own store: back to the options and in again keeps it.
        val viewModel = hiltViewModel<TripViewModel, TripViewModel.Factory>(
            key = "map-trip:${route.journeyKey}:${route.boardingClock}",
            creationCallback = { factory -> factory.create(route) },
        )
        val state by viewModel.state.collectAsStateWithLifecycle()
        val routeSaved by viewModel.routeSaved.collectAsStateWithLifecycle()
        val tripStart by viewModel.tripStart.collectAsStateWithLifecycle()
        val tripAsksLocation by viewModel.tripAsksLocation.collectAsStateWithLifecycle()
        val cardFare by viewModel.cardFare.collectAsStateWithLifecycle()
        val navigator = LocalNavigator.current
        val context = LocalContext.current
        val shareTitle = stringResource(R.string.journey_share_title)

        val journey = (state.trip as? TripPageState.Loaded)?.journey
        val reported = MapRouteShown(route.fromId, route.toId, fromName, toName, journey)
        LaunchedEffect(reported) { onShown(reported) }

        Box(modifier) {
            TripContent(
                state = state,
                innerPadding = PaddingValues(),
                routeSaved = routeSaved,
                onToggleSaveRoute = viewModel::onToggleSaveRoute,
                tripStart = tripStart,
                tripAsksLocation = tripAsksLocation,
                cardFare = cardFare,
                cardFareCheck = cardFareCheck,
                onStartTrip = {
                    viewModel.startTrip()
                    onTripStarted()
                },
                onOpenTrip = { navigator.goTo(Route.ActiveTrip) },
                onPickDeparture = viewModel::onPickDeparture,
                onRetry = viewModel::retry,
                onClose = onClose,
                onSeeOptions = onBack,
                onBack = onBack,
                onShare = { url ->
                    val send = Intent(Intent.ACTION_SEND)
                        .setType("text/plain")
                        .putExtra(Intent.EXTRA_TEXT, url)
                        .putExtra(Intent.EXTRA_TITLE, shareTitle)
                    context.startActivity(Intent.createChooser(send, shareTitle))
                },
            )
        }
    }

    @Composable
    override fun Chip(shown: MapRouteShown, onOpen: () -> Unit, onClear: () -> Unit, modifier: Modifier) {
        val openDescription = stringResource(R.string.journey_map_chip_open)
        Surface(
            modifier = modifier,
            shape = RoundedCornerShape(percent = 50),
            color = MaterialTheme.colorScheme.surfaceContainerLowest,
            shadowElevation = 6.dp,
        ) {
            Row(
                modifier = Modifier.padding(start = 20.dp, end = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(
                    modifier = Modifier
                        .weight(1f, fill = false)
                        .clickable(role = Role.Button, onClickLabel = openDescription, onClick = onOpen)
                        .padding(vertical = 10.dp),
                ) {
                    Text(
                        text = "${shown.fromName ?: "…"} → ${shown.toName ?: "…"}",
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.Bold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    shown.journey?.totalFare?.let { fare ->
                        Text(text = formatRupiah(fare), style = MaterialTheme.typography.bodySmall, color = Slate500)
                    }
                }
                CommuteCloseButton(onClick = onClear, contentDescription = stringResource(R.string.journey_map_chip_clear))
            }
        }
    }
}
