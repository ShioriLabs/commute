package id.shiorilabs.commute.feature.journey.presentation.trip

import android.content.Intent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.chrisbanes.haze.hazeSource
import id.shiorilabs.commute.core.navigation.LocalNavigator
import id.shiorilabs.commute.core.navigation.Route
import id.shiorilabs.commute.core.ui.components.CommuteIconButton
import id.shiorilabs.commute.core.ui.components.NoticeBanner
import id.shiorilabs.commute.core.ui.frost.FrostedHeaderPage
import id.shiorilabs.commute.core.ui.icons.CommuteIcons
import id.shiorilabs.commute.core.ui.preview.CommutePreviewScaffold
import id.shiorilabs.commute.core.ui.time.updatedAgoText
import id.shiorilabs.commute.feature.journey.R
import id.shiorilabs.commute.feature.journey.domain.FareSegment
import id.shiorilabs.commute.feature.journey.domain.Journey
import id.shiorilabs.commute.feature.journey.domain.JourneyLabel
import id.shiorilabs.commute.feature.journey.domain.JourneyLeg
import id.shiorilabs.commute.feature.journey.domain.JourneyStop
import id.shiorilabs.commute.feature.journey.domain.ServiceLine
import id.shiorilabs.commute.feature.journey.presentation.Problem
import id.shiorilabs.commute.feature.journey.presentation.ResultSkeleton
import id.shiorilabs.commute.feature.journey.presentation.components.JourneyCard
import id.shiorilabs.commute.feature.journey.presentation.components.JourneyDetail
import id.shiorilabs.commute.feature.journey.presentation.components.SaveRouteButton
import id.shiorilabs.commute.feature.station.domain.LineInfo
import java.time.Instant

/**
 * One journey in full: its card, the timeline, the recap and the fare breakdown, under a pinned
 * header with the pin, share and close beside the title, frosted once the page scrolls under it.
 */
@Composable
fun TripScreen(
    route: Route.Trip,
    innerPadding: PaddingValues,
    viewModel: TripViewModel = hiltViewModel<TripViewModel, TripViewModel.Factory>(
        creationCallback = { factory -> factory.create(route) },
    ),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val routeSaved by viewModel.routeSaved.collectAsStateWithLifecycle()
    val navigator = LocalNavigator.current
    val context = LocalContext.current
    val shareTitle = stringResource(R.string.journey_share_title)

    TripContent(
        state = state,
        innerPadding = innerPadding,
        routeSaved = routeSaved,
        onToggleSaveRoute = viewModel::onToggleSaveRoute,
        onRetry = viewModel::retry,
        onClose = navigator::pop,
        // Back to the options this was picked from when they sit right behind; otherwise (a saved
        // pair's row on home, a shared link) the OTW tab takes this page's place.
        onSeeOptions = {
            val behind = navigator.backStack.getOrNull(navigator.backStack.lastIndex - 1)
            if (behind is Route.Search || behind is Route.Otw) {
                navigator.pop()
            } else {
                navigator.replace(viewModel.optionsRoute())
            }
        },
        onShare = { url ->
            val send = Intent(Intent.ACTION_SEND)
                .setType("text/plain")
                .putExtra(Intent.EXTRA_TEXT, url)
                .putExtra(Intent.EXTRA_TITLE, shareTitle)
            context.startActivity(Intent.createChooser(send, shareTitle))
        },
    )
}

/** White like the OTW tab it opens from. */
private val TripBackground = Color.White

/** Between the header and the page, on top of the header's own 16 dp: the page's usual 24 in all. */
private val BodyTop = 8.dp

@Composable
private fun TripContent(
    state: TripUiState,
    innerPadding: PaddingValues,
    onClose: () -> Unit,
    onShare: (String) -> Unit,
    onRetry: () -> Unit,
    onSeeOptions: () -> Unit,
    routeSaved: Boolean? = null,
    onToggleSaveRoute: () -> Unit = {},
) {
    FrostedHeaderPage(
        surfaceColor = TripBackground,
        header = {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    // The status bar's height inside the header, so the frost reaches up behind it.
                    .padding(top = innerPadding.calculateTopPadding())
                    .padding(start = 32.dp, top = 32.dp, end = 32.dp, bottom = 16.dp),
                horizontalArrangement = Arrangement.spacedBy(16.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = stringResource(R.string.journey_trip_title),
                    modifier = Modifier
                        .weight(1f)
                        .semantics { heading() },
                    style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.Bold,
                )
                routeSaved?.let { saved ->
                    SaveRouteButton(saved = saved, onClick = onToggleSaveRoute)
                }
                state.shareUrl?.let { url ->
                    CommuteIconButton(onClick = { onShare(url) }, modifier = Modifier.size(32.dp)) {
                        Icon(
                            imageVector = CommuteIcons.Share,
                            contentDescription = stringResource(R.string.journey_share_description),
                            modifier = Modifier.size(24.dp),
                        )
                    }
                }
                CommuteIconButton(onClick = onClose, modifier = Modifier.size(32.dp)) {
                    Icon(
                        imageVector = CommuteIcons.Close,
                        contentDescription = stringResource(R.string.journey_close_description),
                        modifier = Modifier.size(24.dp),
                    )
                }
            }
        },
    ) { headerHeight, listState, hazeState ->
        LazyColumn(
            state = listState,
            modifier = Modifier
                .fillMaxSize()
                .hazeSource(hazeState),
            contentPadding = PaddingValues(
                start = 32.dp,
                top = headerHeight,
                end = 32.dp,
                bottom = innerPadding.calculateBottomPadding() + 32.dp,
            ),
        ) {
            // One item: the page is a single journey, not a list.
            item(key = "trip") {
                when (val trip = state.trip) {
                    TripPageState.Loading -> ResultSkeleton(top = BodyTop)

                    TripPageState.Gone -> Problem(
                        text = stringResource(R.string.journey_trip_gone),
                        onRetry = onSeeOptions,
                        actionLabel = stringResource(R.string.journey_trip_see_options),
                        top = BodyTop,
                    )

                    TripPageState.NotFound -> Problem(text = stringResource(R.string.journey_not_found), top = BodyTop)

                    TripPageState.Failed -> Problem(text = stringResource(R.string.journey_failed), onRetry = onRetry, top = BodyTop)

                    is TripPageState.Loaded -> Column(modifier = Modifier.padding(top = BodyTop)) {
                        // From an old answer kept when a fresh one couldn't be had: its times may
                        // have moved on, so say how old it is.
                        if (trip.isOutdated) {
                            NoticeBanner(
                                message = stringResource(R.string.journey_outdated_banner),
                                detail = trip.updatedAt?.let { updatedAgoText(it) },
                                modifier = Modifier.padding(bottom = 24.dp),
                            )
                        }
                        JourneyCard(journey = trip.journey, lines = state.lines)
                        JourneyDetail(journey = trip.journey, lines = state.lines)
                    }
                }
            }
        }
    }
}

private val previewJourney = run {
    val sudirman = JourneyStop("KCI-SUD", "Sudirman")
    val dukuhAtas = JourneyStop("MRTJ-DKA", "Dukuh Atas BNI")
    val lebakBulus = JourneyStop("MRTJ-LBB", "Lebak Bulus Grab")
    Journey(
        legs = listOf(
            JourneyLeg.Transfer(sudirman, dukuhAtas, distanceM = 90, fare = null, corridorLabel = null),
            JourneyLeg.Ride(
                line = "MRTJ:M",
                operator = "MRTJ",
                from = dukuhAtas,
                to = lebakBulus,
                stationCount = 13,
                stops = listOf(dukuhAtas, JourneyStop("MRTJ-BLM", "Blok M BCA"), lebakBulus),
                headsign = "Lebak Bulus Grab",
                distanceM = 15_700,
                serviceLines = listOf(ServiceLine("MRTJ:M", "Lebak Bulus Grab")),
                departureAt = Instant.parse("2026-10-05T02:23:20Z"),
                arrivalAt = Instant.parse("2026-10-05T02:49:50Z"),
                lastService = false,
                platformCode = null,
            ),
        ),
        segments = listOf(FareSegment("MRTJ", dukuhAtas, lebakBulus, 14_000)),
        totalFare = 14_000,
        totalDistanceM = 15_790,
        transferCount = 0,
        labels = listOf(JourneyLabel.LEAST_WALKING),
        boardings = 1,
        walkDistanceM = 90,
        arrivalAt = Instant.parse("2026-10-05T02:49:50Z"),
    )
}

@Preview(showBackground = true, heightDp = 1200)
@Composable
private fun TripLoadedPreview() {
    CommutePreviewScaffold {
        TripContent(
            state = TripUiState(
                trip = TripPageState.Loaded(previewJourney),
                lines = mapOf("MRTJ:M" to LineInfo("MRT Lin Utara-Selatan", "M", "#DD0067", "MRTJ")),
                shareUrl = "https://commute.shiorilabs.id/fare?from=KCI-SUD&to=MRTJ-LBB",
            ),
            innerPadding = PaddingValues(),
            routeSaved = false,
            onClose = {},
            onShare = {},
            onRetry = {},
            onSeeOptions = {},
        )
    }
}

@Preview(showBackground = true)
@Composable
private fun TripGonePreview() {
    CommutePreviewScaffold {
        TripContent(
            state = TripUiState(trip = TripPageState.Gone),
            innerPadding = PaddingValues(),
            onClose = {},
            onShare = {},
            onRetry = {},
            onSeeOptions = {},
        )
    }
}
