package id.shiorilabs.commute.feature.journey.presentation.trip

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import id.shiorilabs.commute.core.location.LocationPermissions
import id.shiorilabs.commute.core.location.rememberLocationPermissionRequest
import id.shiorilabs.commute.core.notification.rememberNotificationPermissionRequest
import id.shiorilabs.commute.core.ui.theme.Slate200
import id.shiorilabs.commute.core.ui.theme.Slate400
import id.shiorilabs.commute.core.ui.theme.Slate500
import id.shiorilabs.commute.feature.journey.domain.TRIP_START_LEAD
import id.shiorilabs.commute.feature.journey.domain.TripStart
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
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
import id.shiorilabs.commute.core.ui.components.CommuteButton
import id.shiorilabs.commute.core.ui.components.CommuteButtonIcon
import id.shiorilabs.commute.core.ui.components.CommuteButtonText
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
import id.shiorilabs.commute.feature.journey.domain.boardsAt
import id.shiorilabs.commute.feature.journey.domain.formatClock
import id.shiorilabs.commute.feature.journey.domain.formatRupiah
import id.shiorilabs.commute.feature.journey.domain.routeBarSegments
import id.shiorilabs.commute.feature.journey.presentation.Problem
import id.shiorilabs.commute.feature.journey.presentation.ResultSkeleton
import id.shiorilabs.commute.feature.journey.presentation.components.JourneyDetail
import id.shiorilabs.commute.feature.journey.presentation.components.RouteBar
import id.shiorilabs.commute.feature.journey.presentation.components.legLines
import id.shiorilabs.commute.feature.station.domain.LineInfo
import java.time.Instant

/**
 * One journey in full: the timeline, the recap and the fare breakdown, under a pinned header that
 * names the trip by its route bar, clock and fare, frosted once the page scrolls under it.
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
    val tripStart by viewModel.tripStart.collectAsStateWithLifecycle()
    val tripAsksLocation by viewModel.tripAsksLocation.collectAsStateWithLifecycle()
    val navigator = LocalNavigator.current
    val context = LocalContext.current
    val shareTitle = stringResource(R.string.journey_share_title)

    TripContent(
        state = state,
        innerPadding = innerPadding,
        routeSaved = routeSaved,
        onToggleSaveRoute = viewModel::onToggleSaveRoute,
        tripStart = tripStart,
        tripAsksLocation = tripAsksLocation,
        onStartTrip = {
            viewModel.startTrip()
            navigator.goTo(Route.ActiveTrip)
        },
        onOpenTrip = { navigator.goTo(Route.ActiveTrip) },
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
    tripStart: TripStart? = null,
    tripAsksLocation: Boolean = true,
    onStartTrip: () -> Unit = {},
    onOpenTrip: () -> Unit = {},
) {
    FrostedHeaderPage(
        surfaceColor = TripBackground,
        header = { TripHeader(state = state, innerPadding = innerPadding, onClose = onClose) },
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
                        TripActions(
                            tripStart = tripStart,
                            asksLocation = tripAsksLocation,
                            routeSaved = routeSaved,
                            shareUrl = state.shareUrl,
                            onStartTrip = onStartTrip,
                            onOpenTrip = onOpenTrip,
                            onToggleSaveRoute = onToggleSaveRoute,
                            onShare = onShare,
                            modifier = Modifier.padding(bottom = 24.dp),
                        )
                        // From an old answer kept when a fresh one couldn't be had: its times may
                        // have moved on, so say how old it is.
                        if (trip.isOutdated) {
                            NoticeBanner(
                                message = stringResource(R.string.journey_outdated_banner),
                                detail = trip.updatedAt?.let { updatedAgoText(it) },
                                modifier = Modifier.padding(bottom = 24.dp),
                            )
                        }
                        JourneyDetail(journey = trip.journey, lines = state.lines)
                    }
                }
            }
        }
    }
}

/**
 * The journey's route bar where a title would be, with the close beside it and its clock and fare
 * under it. Until there is a journey to draw, a plain title stands in.
 */
@Composable
private fun TripHeader(state: TripUiState, innerPadding: PaddingValues, onClose: () -> Unit) {
    val journey = (state.trip as? TripPageState.Loaded)?.journey

    Column(
        modifier = Modifier
            .fillMaxWidth()
            // The status bar's height inside the header, so the frost reaches up behind it.
            .padding(top = innerPadding.calculateTopPadding())
            .padding(start = 32.dp, top = 32.dp, end = 32.dp, bottom = 16.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (journey != null) {
                RouteBar(
                    segments = routeBarSegments(journey.legs) { legLines(it, state.lines) },
                    plateColor = TripBackground,
                    modifier = Modifier
                        .weight(1f)
                        .semantics { heading() },
                )
            } else {
                Text(
                    text = stringResource(R.string.journey_trip_title),
                    modifier = Modifier
                        .weight(1f)
                        .semantics { heading() },
                    style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.Bold,
                )
            }
            CommuteIconButton(onClick = onClose, modifier = Modifier.size(32.dp)) {
                Icon(
                    imageVector = CommuteIcons.Close,
                    contentDescription = stringResource(R.string.journey_close_description),
                    modifier = Modifier.size(24.dp),
                )
            }
        }

        if (journey != null) {
            TripSubtitle(journey, modifier = Modifier.padding(top = 4.dp))
        }
    }
}

/**
 * The page's one row of actions: "OTW!" filling it, then pinning the pair to home and sharing the
 * trip as square icons. TalkBack reads each in full.
 */
@Composable
private fun TripActions(
    tripStart: TripStart?,
    asksLocation: Boolean,
    routeSaved: Boolean?,
    shareUrl: String?,
    onStartTrip: () -> Unit,
    onOpenTrip: () -> Unit,
    onToggleSaveRoute: () -> Unit,
    onShare: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    if (tripStart == null && routeSaved == null && shareUrl == null) return
    val haptics = LocalHapticFeedback.current
    // As tall as each other: the icons are squares as tall as the OTW button.
    Row(
        modifier = modifier
            .fillMaxWidth()
            .height(IntrinsicSize.Min),
        horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End),
    ) {
        tripStart?.let {
            TripStartButton(start = it, asksLocation = asksLocation, onStart = onStartTrip, onOpen = onOpenTrip, modifier = Modifier.weight(1f))
        }
        routeSaved?.let { saved ->
            TripIconButton(
                description = stringResource(if (saved) R.string.journey_unsave_route else R.string.journey_save_route),
                icon = if (saved) CommuteIcons.Pinned else CommuteIcons.Pin,
                onClick = {
                    haptics.performHapticFeedback(if (saved) HapticFeedbackType.ToggleOff else HapticFeedbackType.ToggleOn)
                    onToggleSaveRoute()
                },
            )
        }
        shareUrl?.let { url ->
            TripIconButton(
                description = stringResource(R.string.journey_share_description),
                icon = CommuteIcons.Share,
                onClick = { onShare(url) },
            )
        }
    }
}

/**
 * Trip mode's way in: "OTW!", or "Lihat perjalanan" while this journey is the one being followed.
 * The permissions it uses are asked for here, on the tap, and a refusal still starts the trip:
 * without location it runs on the clock, without notifications it only shows in the app.
 */
@Composable
private fun TripStartButton(
    start: TripStart,
    asksLocation: Boolean,
    onStart: () -> Unit,
    onOpen: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val haptics = LocalHapticFeedback.current
    val askLocation = rememberLocationPermissionRequest { onStart() }
    val askNotifications = rememberNotificationPermissionRequest {
        if (!asksLocation || locationGranted(context)) onStart() else askLocation()
    }
    val begin = {
        haptics.performHapticFeedback(HapticFeedbackType.Confirm)
        when {
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && !granted(context, Manifest.permission.POST_NOTIFICATIONS) ->
                askNotifications()
            asksLocation && !locationGranted(context) -> askLocation()
            else -> onStart()
        }
    }
    val enabled = start !is TripStart.TooEarly
    val label = when (start) {
        TripStart.Ready -> stringResource(R.string.journey_trip_start)
        TripStart.Running -> stringResource(R.string.journey_trip_open)
        is TripStart.TooEarly -> stringResource(R.string.journey_trip_too_early, formatClock(start.boardsAt.minus(TRIP_START_LEAD)))
    }
    val description = if (start == TripStart.Ready) stringResource(R.string.journey_trip_start_description) else label
    val onClick = if (start == TripStart.Running) onOpen else begin
    CommuteButton(
        onClick = onClick,
        modifier = modifier.clearAndSetSemantics {
            contentDescription = description
            role = Role.Button
            if (enabled) onClick { onClick(); true }
        },
        enabled = enabled,
    ) {
        // Mirrored to point right, as the station page's "OTW Ke Sini" draws it.
        CommuteButtonIcon(CommuteIcons.NavigationArrow, modifier = Modifier.scale(scaleX = -1f, scaleY = 1f))
        CommuteButtonText(label)
    }
}

private fun granted(context: Context, permission: String) =
    ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED

private fun locationGranted(context: Context) = LocationPermissions.any { granted(context, it) }

/** A secondary action as a square on slate, as tall as the row it sits in. */
@Composable
private fun TripIconButton(description: String, icon: ImageVector, onClick: () -> Unit) {
    Box(
        modifier = Modifier
            .fillMaxHeight()
            .aspectRatio(1f, matchHeightConstraintsFirst = true)
            .clip(RoundedCornerShape(12.dp))
            .background(Slate200)
            .clickable(role = Role.Button, onClick = onClick)
            .clearAndSetSemantics {
                contentDescription = description
                role = Role.Button
                onClick { onClick(); true }
            },
        contentAlignment = Alignment.Center,
    ) {
        Icon(imageVector = icon, contentDescription = null, modifier = Modifier.size(20.dp), tint = MaterialTheme.colorScheme.primary)
    }
}

/** When it leaves and arrives, then what it costs; just the fare where the journey isn't timed. */
@Composable
private fun TripSubtitle(journey: Journey, modifier: Modifier = Modifier) {
    val boardsAt = journey.boardsAt
    val arrivalAt = journey.arrivalAt
    val fare = journey.totalFare?.let(::formatRupiah) ?: stringResource(R.string.journey_fare_unknown)
    Text(
        text = buildAnnotatedString {
            if (boardsAt != null) {
                append(formatClock(boardsAt))
                if (arrivalAt != null) {
                    withStyle(SpanStyle(color = Slate400)) { append(" → ") }
                    append(formatClock(arrivalAt))
                }
                withStyle(SpanStyle(color = Slate400)) { append(" · ") }
            }
            append(fare)
        },
        modifier = modifier,
        style = MaterialTheme.typography.bodyMedium,
        fontWeight = FontWeight.SemiBold,
        color = Slate500,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
    )
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
