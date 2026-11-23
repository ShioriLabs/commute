package id.shiorilabs.commute.feature.map.presentation

import androidx.activity.compose.BackHandler
import androidx.annotation.StringRes
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.EnterExitState
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.AndroidExternalSurface
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.movableContentOf
import androidx.compose.runtime.movableContentWithReceiverOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Path
import kotlin.math.abs
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.GraphicsLayerScope
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.input.pointer.PointerEventType
import androidx.compose.ui.input.pointer.changedToDownIgnoreConsumed
import androidx.compose.ui.input.pointer.changedToUpIgnoreConsumed
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChanged
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.LifecycleStartEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import id.shiorilabs.commute.core.constants.OPERATOR_TJ
import id.shiorilabs.commute.core.navigation.LocalNavigator
import id.shiorilabs.commute.core.navigation.Route
import id.shiorilabs.commute.core.type.UIState
import id.shiorilabs.commute.core.ui.components.CommuteButton
import id.shiorilabs.commute.core.ui.components.CommuteButtonIcon
import id.shiorilabs.commute.core.ui.components.CommuteButtonText
import id.shiorilabs.commute.core.ui.components.CommuteCloseButton
import id.shiorilabs.commute.core.ui.components.CommuteIconButton
import id.shiorilabs.commute.core.ui.components.LineRoundel
import id.shiorilabs.commute.core.ui.components.ProblemPanel
import id.shiorilabs.commute.core.ui.components.RoundelSize
import id.shiorilabs.commute.core.ui.icons.CommuteIcons
import id.shiorilabs.commute.core.ui.morph.LocalNavAnimatedVisibilityScope
import id.shiorilabs.commute.core.ui.morph.LocalSharedTransitionScope
import id.shiorilabs.commute.core.ui.morph.NavCardMorphTarget
import id.shiorilabs.commute.core.ui.motion.rememberReducedMotion
import id.shiorilabs.commute.core.ui.theme.DarkStatusBarIcons
import id.shiorilabs.commute.core.ui.theme.Slate100
import id.shiorilabs.commute.core.ui.theme.Slate200
import id.shiorilabs.commute.core.ui.theme.Slate500
import id.shiorilabs.commute.core.ui.theme.Slate600
import id.shiorilabs.commute.feature.hub.presentation.HubSheet
import id.shiorilabs.commute.feature.journey.domain.PairEnd
import id.shiorilabs.commute.feature.journey.presentation.MapRouteSheet
import id.shiorilabs.commute.feature.journey.presentation.MapRouteShown
import id.shiorilabs.commute.feature.line.presentation.LineSheet
import id.shiorilabs.commute.feature.map.R
import id.shiorilabs.commute.feature.map.domain.BusMapLineInfo
import id.shiorilabs.commute.feature.map.domain.MapData
import id.shiorilabs.commute.feature.map.domain.MapLine
import id.shiorilabs.commute.feature.map.domain.lineKeyOf
import id.shiorilabs.commute.feature.map.domain.MapSelection
import id.shiorilabs.commute.feature.map.domain.Viewport
import id.shiorilabs.commute.feature.map.domain.approximateSpot
import id.shiorilabs.commute.feature.station.presentation.StationSheet
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.PI
import kotlin.math.cos

/**
 * The FDTJ integration map, edge to edge under the system bars, with a way back over it, and a
 * sheet over it for the station, hub or line tapped, as the web's phone layout shows them. [route]
 * may carry a pair whose route is drawn over it.
 */
@Composable
fun MapScreen(
    route: Route.Map,
    innerPadding: PaddingValues,
    stationSheet: StationSheet,
    hubSheet: HubSheet,
    lineSheet: LineSheet,
    routeSheet: MapRouteSheet,
    viewModel: MapViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val navigator = LocalNavigator.current

    // Grows out of home's white rail card, as the other rail screens do.
    NavCardMorphTarget(destination = Route.Map(), cardTint = null) {
        // The artwork is drawn on white whatever the theme, as on the web.
        Box(Modifier.fillMaxSize().background(Color.White)) {
            when (val current = state) {
                is UIState.Success -> MapWithSheet(current.data, route, viewModel, innerPadding, stationSheet, hubSheet, lineSheet, routeSheet)
                is UIState.Error -> {
                    ProblemPanel(
                        message = stringResource(R.string.map_load_failed),
                        retryLabel = stringResource(R.string.map_retry),
                        onRetry = viewModel::retry,
                        modifier = Modifier.align(Alignment.Center).padding(24.dp),
                    )
                    MapChrome(innerPadding, onBack = { navigator.pop() })
                }

                else -> {
                    CircularProgressIndicator(Modifier.align(Alignment.Center))
                    MapChrome(innerPadding, onBack = { navigator.pop() })
                }
            }
        }
    }
}

/**
 * The status bar's scrim and the close at the top right, as home's other rail pages close, over the
 * map; with [title] the web's "Peta Integrasi" pill at the top left, faded out while [titleVisible]
 * is false.
 */
@Composable
private fun BoxScope.MapChrome(
    innerPadding: PaddingValues,
    onBack: (() -> Unit)?,
    title: Boolean = false,
    titleVisible: Boolean = true,
    @StringRes titleRes: Int = R.string.map_title,
) {
    // Light icons over a navy scrim that fades out below the status bar, as KitKat's translucent
    // bar did, whatever the theme: the artwork's busy top edge would otherwise run under the
    // clock, and a solid bar would cut it off.
    DarkStatusBarIcons()
    Box(
        Modifier
            .fillMaxWidth()
            .height(innerPadding.calculateTopPadding() * STATUS_SCRIM_REACH)
            .background(StatusScrim),
    )

    if (onBack != null) CommuteIconButton(
        onClick = onBack,
        modifier = Modifier
            .align(Alignment.TopEnd)
            .padding(top = innerPadding.calculateTopPadding() + 8.dp, end = 12.dp)
            .chromeEnter(0)
            .size(40.dp)
            .shadow(2.dp, CircleShape)
            .background(MaterialTheme.colorScheme.surface, CircleShape),
    ) {
        Icon(
            imageVector = CommuteIcons.Close,
            contentDescription = stringResource(R.string.map_close),
            modifier = Modifier.size(22.dp),
            tint = MaterialTheme.colorScheme.onSurface,
        )
    }
    if (title) {
        val shown by animateFloatAsState(if (titleVisible) 1f else 0f, tween(TITLE_FADE_MILLIS), label = "title")
        Text(
            text = stringResource(titleRes),
            modifier = Modifier
                .padding(top = innerPadding.calculateTopPadding() + 8.dp, start = 16.dp, end = 64.dp)
                .chromeEnter(1)
                .graphicsLayer {
                    alpha = shown
                    fadeShadowsWhole()
                }
                .shadow(4.dp, CircleShape)
                .background(MaterialTheme.colorScheme.surface, CircleShape)
                .padding(horizontal = 16.dp, vertical = 9.dp),
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.Bold,
            maxLines = 1,
        )
    }
}

/**
 * Chrome arriving with the map, the web's `map-chrome-enter`: up 8 dp into place and in, each
 * [index] a step after the one before. Straight in place with the system's animations off.
 */
@Composable
private fun Modifier.chromeEnter(index: Int): Modifier {
    val reduced = rememberReducedMotion()
    val progress = remember { Animatable(if (reduced) 1f else 0f) }
    LaunchedEffect(Unit) {
        if (progress.value < 1f) {
            delay(index * CHROME_STAGGER_MILLIS)
            progress.animateTo(1f, tween(CHROME_ENTER_MILLIS, easing = FastOutSlowInEasing))
        }
    }
    return graphicsLayer {
        alpha = progress.value
        translationY = (1 - progress.value) * CHROME_ENTER_RISE.toPx()
        fadeShadowsWhole()
    }
}

/**
 * Fades by each thing drawn rather than through a layer the size of the chrome: a shadow reaches
 * past its button, and drawn into that layer it was cut off square until the fade was done.
 */
private fun GraphicsLayerScope.fadeShadowsWhole() {
    compositingStrategy = CompositingStrategy.ModulateAlpha
}

/** A tap's ripple, the web's `map-ripple`: a ring grown out of where it landed, fading. */
@Composable
private fun TapRipples(controller: MapController) {
    val ripples by controller.ripples.collectAsStateWithLifecycle()
    val reduced = rememberReducedMotion()
    for (ripple in ripples) {
        key(ripple.id) {
            val progress = remember { Animatable(0f) }
            LaunchedEffect(Unit) {
                if (!reduced) progress.animateTo(1f, tween(RIPPLE_MILLIS, easing = FastOutSlowInEasing))
                controller.rippleDone(ripple.id)
            }
            if (!reduced) {
                Canvas(Modifier.fillMaxSize()) {
                    val p = progress.value
                    val scale = RIPPLE_SCALE_FROM + (RIPPLE_SCALE_TO - RIPPLE_SCALE_FROM) * p
                    drawCircle(
                        color = RippleColor.copy(alpha = RippleColor.alpha * RIPPLE_OPACITY * (1 - p)),
                        radius = RIPPLE_RADIUS.toPx() * scale,
                        center = Offset(ripple.xPx, ripple.yPx),
                        style = Stroke(width = RIPPLE_STROKE.toPx() * scale),
                    )
                }
            }
        }
    }
}

/** A round white button over the map, as the back button is. */
@Composable
private fun MapButton(icon: androidx.compose.ui.graphics.vector.ImageVector, description: String, onClick: () -> Unit, modifier: Modifier = Modifier) {
    CommuteIconButton(
        onClick = onClick,
        modifier = modifier
            .size(44.dp)
            .shadow(4.dp, CircleShape)
            .background(MaterialTheme.colorScheme.surface, CircleShape),
    ) {
        Icon(imageVector = icon, contentDescription = description, modifier = Modifier.size(20.dp), tint = MaterialTheme.colorScheme.onSurface)
    }
}

/** The north button: a compass needle, red to the north, turned as the map is. */
@Composable
private fun NorthButton(bearing: Float, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val description = stringResource(R.string.map_north_up)
    CommuteIconButton(
        onClick = onClick,
        modifier = modifier
            .size(44.dp)
            .shadow(4.dp, CircleShape)
            .background(MaterialTheme.colorScheme.surface, CircleShape)
            .semantics { contentDescription = description },
    ) {
        val south = MaterialTheme.colorScheme.onSurface
        Canvas(Modifier.size(22.dp).rotate(-bearing)) {
            val cx = size.width / 2
            val cy = size.height / 2
            val half = size.width * 0.18f
            val north = Path().apply {
                moveTo(cx, 0f)
                lineTo(cx + half, cy)
                lineTo(cx - half, cy)
                close()
            }
            val tail = Path().apply {
                moveTo(cx, size.height)
                lineTo(cx + half, cy)
                lineTo(cx - half, cy)
                close()
            }
            drawPath(north, NorthRed)
            drawPath(tail, south)
        }
    }
}

private val NorthRed = Color(0xFFE11D48)

/** How far off north the map turns before the north button shows. */
private const val NORTH_SLACK_DEG = 0.5

/** One button's step down the map's right column: 44 dp tall and a gap, as the layers and debug buttons sit. */
private val BUTTON_STEP = 52.dp

/** The map's credit, the web's attribution popover: whose map it is, and which edition. */
@Composable
private fun Attribution(version: String, modifier: Modifier = Modifier) {
    val title = stringResource(R.string.map_attribution_title)
    Surface(
        modifier = modifier
            .widthIn(max = 320.dp)
            .semantics { paneTitle = title },
        shape = RoundedCornerShape(12.dp),
        color = MaterialTheme.colorScheme.surfaceContainerLowest,
        border = BorderStroke(1.dp, Slate200),
        shadowElevation = 12.dp,
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(text = title, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
            Text(text = stringResource(R.string.map_attribution_credit), style = MaterialTheme.typography.bodySmall, color = Slate600)
            Text(text = stringResource(R.string.map_attribution_version, version), style = MaterialTheme.typography.bodySmall, color = Slate500)
        }
    }
}

/**
 * The map with its sheet: closed until a station, hub or line is tapped, then up at its peek, and
 * dragged to full or away. One at a time, as on the web; back closes it before leaving the map, or
 * from a line opened from a station's sheet, goes back to that station.
 */
@Composable
private fun MapWithSheet(
    data: MapData,
    route: Route.Map,
    viewModel: MapViewModel,
    innerPadding: PaddingValues,
    stationSheet: StationSheet,
    hubSheet: HubSheet,
    lineSheet: LineSheet,
    routeSheet: MapRouteSheet,
    home: HomeSlots? = null,
) {
    val navigator = LocalNavigator.current
    val density = LocalDensity.current.density
    val haptics = LocalHapticFeedback.current
    val controller = remember(data) { viewModel.controller(data, density) }
    SideEffect { controller.onHit = { haptics.performHapticFeedback(HapticFeedbackType.ContextClick) } }
    val selection by controller.selection.collectAsStateWithLifecycle()
    val lineChoices by controller.lineChoices.collectAsStateWithLifecycle()

    val mapRoute by viewModel.route.collectAsStateWithLifecycle()
    val picking by viewModel.picking.collectAsStateWithLifecycle()
    val activeTrip by viewModel.activeTrip.collectAsStateWithLifecycle()
    val chromeVisible by controller.isChromeVisible.collectAsStateWithLifecycle()
    val zoomedIn by controller.isZoomedIn.collectAsStateWithLifecycle()
    val reducedMotion = rememberReducedMotion()
    SideEffect { controller.reducedMotion = reducedMotion }
    // The attribution: open until its button, or any tap on the map, closes it.
    var attributionOpen by remember { mutableStateOf(false) }
    SideEffect { controller.onTap = { attributionOpen = false } }

    // The pair a link opened the map on: OTW's sheet opens on it.
    LaunchedEffect(controller) {
        if (viewModel.seed(route)) controller.openRouteSheet()
    }
    // What the sheet last said to draw for the pair, its pins alone until then; with none being
    // planned, the running trip with the rider on it.
    LaunchedEffect(controller, mapRoute, activeTrip) {
        val current = mapRoute
        val trip = activeTrip
        when {
            current.isSet -> {
                val shown = current.shown?.takeIf { it.fromId == current.fromId && it.toId == current.toId }
                controller.setRoute(shown?.journey?.routeLegs().orEmpty(), current.fromId, current.toId)
            }

            trip != null -> controller.setRoute(
                legs = trip.plan.routeLegs(),
                fromId = trip.plan.ride(trip.plan.rideIndices.first()).stops.first().id,
                toId = trip.plan.destination.id,
                progress = trip.rideProgress(),
            )

            else -> controller.clearRoute()
        }
    }
    // A trip starting: the camera goes in close on the rider and stays with them until the map is
    // moved. Not while a pair is being planned over it, whose route is the one drawn.
    val following by controller.isFollowingRider.collectAsStateWithLifecycle()
    val tripShown = activeTrip != null && !mapRoute.isSet
    LaunchedEffect(controller, tripShown) {
        if (tripShown) controller.followRider()
    }
    // An end armed: the next station tapped fills it, and the sheet comes back with the pair.
    SideEffect {
        controller.pickStation = if (picking != null) {
            { stationId -> viewModel.pick(stationId).also { taken -> if (taken) controller.openRouteSheet() } }
        } else {
            null
        }
    }
    // Opened from "Cek rute dan tarif": up at full, as the web's, rather than its peek.
    var routeSheetFull by remember { mutableStateOf(false) }
    // The streets layer, Experimental "Peta Jalan", picked from the layers button as Google Maps'
    // satellite is, on home's map as on this one. Not while a pair is planned or an end picked:
    // routes are drawn on the artwork.
    val streetsEnabled by viewModel.streetsEnabled.collectAsStateWithLifecycle()
    val streetsPicked by viewModel.streetsPicked.collectAsStateWithLifecycle()
    val busMap by viewModel.busMap.collectAsStateWithLifecycle()
    val layersOffered = streetsEnabled && !mapRoute.isSet && picking == null
    val streets = layersOffered && streetsPicked
    LaunchedEffect(streets) {
        if (streets) viewModel.loadBusMap()
    }
    val streetsState = rememberStreetsMapState(viewModel.session)
    val dark = MaterialTheme.colorScheme.surface.luminance() < 0.5f
    var layersOpen by remember { mutableStateOf(false) }
    LaunchedEffect(selection, layersOffered) {
        if (selection != null || !layersOffered) layersOpen = false
    }
    // Experimental "Panel Debug Peta": a button under the layers one on the streets, opening its panel.
    val debugEnabled by viewModel.debugEnabled.collectAsStateWithLifecycle()
    val streetsLines by viewModel.streetsLines.collectAsStateWithLifecycle()
    val streetsDots by viewModel.streetsDots.collectAsStateWithLifecycle()
    val streetsOverview by viewModel.streetsOverview.collectAsStateWithLifecycle()
    val streetsApart by viewModel.streetsApart.collectAsStateWithLifecycle()
    val streetsCity by viewModel.streetsCity.collectAsStateWithLifecycle()
    val streetsWeight by viewModel.streetsWeight.collectAsStateWithLifecycle()
    val streetsJoins by viewModel.streetsJoins.collectAsStateWithLifecycle()
    val feedLines by viewModel.feedLines.collectAsStateWithLifecycle()
    val debugOffered = streets && debugEnabled
    var debugOpen by remember { mutableStateOf(false) }
    LaunchedEffect(selection, debugOffered) {
        if (selection != null || !debugOffered) debugOpen = false
    }
    // Raw left picked earlier in the run: its lines read again for this map.
    LaunchedEffect(debugOffered, streetsLines) {
        if (debugOffered && streetsLines == StreetsLines.RAW) viewModel.loadFeed()
    }

    // Dragged or flicked away: the selection goes with it, the camera and spotlight leaving as the
    // sheet does rather than once it has gone.
    // Home on the map: its feed in the sheet until the map is panned, then the stations in view.
    var mode by remember { mutableStateOf(HomeMode.Feed) }
    var nearbyIds by remember { mutableStateOf(emptyList<String>()) }
    var moves by remember { mutableIntStateOf(0) }
    SideEffect {
        controller.onUserMove = if (home != null) {
            {
                if (controller.selection.value == null && mode == HomeMode.Feed) mode = HomeMode.Nearby
                moves++
            }
        } else {
            {}
        }
    }
    // Opens around the rider once home knows where they are, or on Manggarai with them nowhere near
    // a station: once for this map, so neither coming back to it nor a later look moves the camera.
    LaunchedEffect(controller, home?.riderNear) {
        val near = home?.riderNear ?: return@LaunchedEffect
        if (viewModel.homeCentred) return@LaunchedEffect
        viewModel.homeCentred = true
        val spot = approximateSpot(data.points, near.map { it.stationId to it.distanceM })
        val at = spot ?: data.initialPoint?.let { it.centerX to it.centerY } ?: return@LaunchedEffect
        controller.centreOn(at.first, at.second)
    }
    // The stations in view once the map has stopped under the finger, and again once a fling has:
    // on the streets, Peta Bus's dots above the sheet.
    val stationsInView = {
        if (streets) {
            busMap?.let { streetsState.stationsInView(it.stops, STREETS_IN_VIEW) }.orEmpty()
        } else {
            controller.stationsInView()
        }
    }
    LaunchedEffect(moves, mode, streets) {
        if (home == null || mode != HomeMode.Nearby) return@LaunchedEffect
        delay(NEARBY_SETTLE_MS)
        nearbyIds = stationsInView()
        delay(NEARBY_FLING_MS)
        nearbyIds = stationsInView()
    }
    val restFraction = when {
        home == null -> 0.0
        mode == HomeMode.Feed -> HOME_REST_FRACTION
        else -> Viewport.PEEK_FRACTION
    }
    LaunchedEffect(restFraction) {
        controller.setRestInset(restFraction)
    }
    val sheetState = rememberMapSheetState(
        onHiding = {
            if (controller.selection.value != null) controller.clearSelection() else if (home != null) mode = HomeMode.Feed
        },
    )
    // Home's feed in a sheet of its own, so it slides away as the map's comes up over it, as
    // Citymapper's does, and keeps its place in the list meanwhile. Up at its rest from the start.
    // Dragged away, it leaves the map to be looked at, as a pan does.
    // Home's own, from before the map had loaded, so the feed stays where the rider left it.
    val feedState = home?.feedState ?: rememberMapSheetState(onHiding = {}, initial = SheetStop.Rest)
    SideEffect { feedState.onHiding = { mode = HomeMode.Nearby } }
    val feedShown = home != null && selection == null && mode == HomeMode.Feed
    LaunchedEffect(feedShown) {
        // Called back only from away: up at full as the map arrives, it stays there.
        if (!feedShown) {
            feedState.moveTo(SheetStop.Hidden)
        } else if (feedState.stop == SheetStop.Hidden) {
            feedState.moveTo(SheetStop.Rest)
        }
    }

    // Up at its peek for a selection, away without one, and down to it for a line, which is drawn
    // on the map rather than in the sheet.
    val showsLine = selection is MapSelection.Line
    LaunchedEffect(selection != null, showsLine, routeSheetFull, mode) {
        sheetState.moveTo(
            when {
                selection == null && home != null -> if (mode == HomeMode.Feed) SheetStop.Hidden else SheetStop.Peek
                selection == null -> SheetStop.Hidden
                routeSheetFull && selection == MapSelection.Route -> SheetStop.Full
                else -> SheetStop.Peek
            },
        )
    }
    LaunchedEffect(selection) {
        if (selection != MapSelection.Route) routeSheetFull = false
    }
    BackHandler(enabled = selection != null) {
        when {
            showsLine -> controller.backFromLine()
            // A journey's page goes back to the options first.
            selection == MapSelection.Route && mapRoute.journey != null -> viewModel.closeJourney()
            else -> controller.clearSelection()
        }
    }
    // Back from the stations in view to home's feed, the map left where it is.
    BackHandler(enabled = home != null && selection == null && mode == HomeMode.Nearby) { mode = HomeMode.Feed }
    // Declared after, so they go first.
    BackHandler(enabled = picking != null) { viewModel.disarm() }
    BackHandler(enabled = lineChoices.isNotEmpty()) { controller.dismissLineChoices() }

    val openStation = { stationId: String ->
        if (!controller.selectStation(stationId)) navigator.goTo(Route.Station(stationId))
    }
    val openLine = { lineKey: String ->
        if (!controller.isolateLine(lineKey)) {
            navigator.goTo(Route.Line(lineKey.substringBefore(':'), lineKey.substringAfter(':')))
        }
    }

    BackHandler(enabled = layersOpen) { layersOpen = false }

    // A line picked on the streets: a koridor the artwork knows opens its sheet there, as on the
    // artwork; any other is named in a pill. Either way it's drawn alone, the rest faded.
    var streetsPill by remember { mutableStateOf<String?>(null) }
    // As Peta Bus codes it: a koridor by its code, a rail line by its key.
    val isolatedLine = (selection as? MapSelection.Line)?.line?.let { if (it.operator == OPERATOR_TJ) it.code else it.key } ?: streetsPill
    LaunchedEffect(streets) {
        if (!streets) streetsPill = null
    }
    BackHandler(enabled = streetsPill != null && selection == null) { streetsPill = null }
    val openStreetsLine = { codes: List<String> ->
        layersOpen = false
        attributionOpen = false
        // A stroke a colour's lines share (13, 13E, L13E) asks which, as a shared stroke does on the artwork.
        if (codes.size < 2 || !controller.offerLineChoices(codes.map(::lineKeyOf))) {
            val code = codes.first()
            streetsPill = if (controller.isolateLine(lineKeyOf(code))) null else code
        }
    }

    BoxWithConstraints(Modifier.fillMaxSize()) {
        val topInset = innerPadding.calculateTopPadding()
        val height = maxHeight
        // The feed resting over the foot of the streets too: the camera centres on what shows above it.
        val streetsHeightPx = with(LocalDensity.current) { height.toPx() }.toDouble()
        LaunchedEffect(restFraction, streetsHeightPx) {
            streetsState.setBottomInset(streetsHeightPx * restFraction)
        }
        // A line picked: all of it in view, above its sheet when one comes up.
        val frameEdgePx = with(LocalDensity.current) { LINE_FRAME_EDGE.toPx() }.toDouble()
        LaunchedEffect(streets, isolatedLine, busMap) {
            val code = isolatedLine ?: return@LaunchedEffect
            val info = busMap?.lines?.get(code) ?: return@LaunchedEffect
            if (!streets) return@LaunchedEffect
            val sheetPx = if (selection != null) streetsHeightPx * Viewport.PEEK_FRACTION else 0.0
            streetsState.frame(info, bottomPx = sheetPx, edgePx = frameEdgePx)
        }
        Box(Modifier.fillMaxSize()) {
            if (streets) {
                StreetsLayer(
                    state = streetsState,
                    styleUrl = viewModel.streetsStyleUrl(dark),
                    busMap = busMap,
                    dark = dark,
                    onStationTap = { stationId ->
                        streetsPill = null
                        openStation(stationId)
                    },
                    onTap = {
                        attributionOpen = false
                        layersOpen = false
                        debugOpen = false
                        streetsPill = null
                    },
                    onUserMove = { controller.onUserMove() },
                    onLineTap = openStreetsLine,
                    isolated = isolatedLine,
                    lines = if (debugOffered) streetsLines else StreetsLines.ADJUSTED,
                    feed = feedLines,
                    dots = if (debugOffered) streetsDots else StreetsDots.ALL,
                    overview = if (debugOffered) streetsOverview else StreetsOverview.BUNDLED,
                    apart = if (debugOffered) streetsApart else StreetsApart.SEPARATED,
                    city = streetsCity,
                    weight = if (debugOffered) streetsWeight else StreetsWeight.NORMAL,
                    joins = if (debugOffered) streetsJoins else StreetsJoins.CONTINUOUS,
                )
                val pill = streetsPill?.let { busMap?.lines?.get(it) }
                if (pill != null && selection == null) {
                    StreetsLinePill(
                        line = pill,
                        onClose = { streetsPill = null },
                        modifier = Modifier
                            .align(Alignment.TopCenter)
                            .padding(top = topInset + LINE_PILL_TOP, start = 16.dp, end = 16.dp),
                    )
                }
            } else {
                MapSurface(controller, viewModel)
                TapRipples(controller)
                val lost by controller.isLost.collectAsStateWithLifecycle()
                if (lost) MapLost(onRetry = controller::retryRenderer)
            }
            if (home == null) {
                MapChrome(
                    innerPadding,
                    onBack = { navigator.pop() },
                    title = true,
                    titleVisible = streets || chromeVisible,
                    titleRes = if (streets) R.string.map_streets_title else R.string.map_title,
                )
            } else {
                MapChrome(innerPadding, onBack = null)
            }
            if (layersOffered) {
                MapButton(
                    icon = CommuteIcons.MapLayers,
                    description = stringResource(R.string.map_layers_open),
                    onClick = {
                        haptics.performHapticFeedback(HapticFeedbackType.ContextClick)
                        attributionOpen = false
                        debugOpen = false
                        layersOpen = !layersOpen
                    },
                    // Under the close, centred on it; at the top right on home, which has none.
                    modifier = Modifier
                        .align(Alignment.TopEnd)
                        .padding(top = topInset + if (home == null) LAYERS_BUTTON_TOP else LAYERS_BUTTON_TOP_HOME, end = 10.dp)
                        .chromeEnter(2),
                )
            }
            if (debugOffered) {
                MapButton(
                    icon = CommuteIcons.MapDebug,
                    description = stringResource(R.string.map_debug_open),
                    onClick = {
                        haptics.performHapticFeedback(HapticFeedbackType.ContextClick)
                        attributionOpen = false
                        layersOpen = false
                        debugOpen = !debugOpen
                    },
                    // Under the layers button.
                    modifier = Modifier
                        .align(Alignment.TopEnd)
                        .padding(top = topInset + if (home == null) DEBUG_BUTTON_TOP else DEBUG_BUTTON_TOP_HOME, end = 10.dp)
                        .chromeEnter(2),
                )
            }
            // The streets turned off north: a needle turning with them, a tap turns them back.
            val turned = streets && abs(((streetsState.bearing % 360) + 360) % 360).let { minOf(it, 360 - it) } > NORTH_SLACK_DEG
            AnimatedVisibility(
                visible = turned,
                enter = fadeIn(),
                exit = fadeOut(),
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .padding(
                        top = topInset + (if (home == null) LAYERS_BUTTON_TOP else LAYERS_BUTTON_TOP_HOME) +
                            BUTTON_STEP * ((if (layersOffered) 1 else 0) + (if (debugOffered) 1 else 0)),
                        end = 10.dp,
                    ),
            ) {
                NorthButton(
                    bearing = streetsState.bearing.toFloat(),
                    onClick = {
                        haptics.performHapticFeedback(HapticFeedbackType.ContextClick)
                        streetsState.northUp()
                    },
                )
            }
        }
        if (home != null) {
            HomeFeedSheet(state = feedState, screenHeight = height, topInset = topInset, stops = HomeFeedStops) {
                home.feed(openStation)
            }
            // Home's rail over the foot of the feed, leaving and coming back with it.
            AnimatedVisibility(
                visible = feedShown && picking == null,
                enter = slideInVertically(tween(RAIL_SLIDE_MILLIS)) { it },
                exit = slideOutVertically(tween(RAIL_SLIDE_MILLIS)) { it },
                modifier = Modifier.align(Alignment.BottomCenter).fillMaxWidth(),
            ) {
                Box(Modifier.fillMaxWidth()) { home.rail(this) }
            }
        }

        // Full stops short of the status bar, the clock left clear.
        MapSheet(
            state = sheetState,
            screenHeight = height,
            height = height - topInset - SHEET_TOP_GAP,
            peek = height * Viewport.PEEK_FRACTION.toFloat(),
            fullTop = topInset + SHEET_TOP_GAP,
            shape = RoundedCornerShape(topStart = SHEET_CORNER, topEnd = SHEET_CORNER),
            color = MaterialTheme.colorScheme.surfaceContainerLowest,
            shadowElevation = 8.dp,
        ) {
            when (val shown = selection) {
                is MapSelection.Station -> key(shown.stationId) {
                    stationSheet.Content(
                        stationId = shown.stationId,
                        onClose = controller::clearSelection,
                        onOpenPage = { navigator.goTo(Route.Station(shown.stationId)) },
                        onOpenStation = openStation,
                        // The destination set, the origin picked on the map, as the web's map does.
                        onOtw = {
                            viewModel.otwTo(shown.stationId)
                            controller.clearSelection()
                        },
                        onIsolateLine = { lineKey -> controller.isolateLine(lineKey, fromStationId = shown.stationId) },
                        modifier = Modifier.fillMaxSize(),
                    )
                }

                is MapSelection.Hub -> key(shown.slug) {
                    hubSheet.Content(
                        slug = shown.slug,
                        onClose = controller::clearSelection,
                        onOpenPage = { navigator.goTo(Route.Hub(shown.slug)) },
                        onOpenStation = openStation,
                        modifier = Modifier.fillMaxSize(),
                    )
                }

                is MapSelection.Line -> key(shown.line.key) {
                    val line = shown.line
                    lineSheet.Content(
                        operator = line.operator,
                        lineCode = line.code,
                        title = line.name,
                        colorCode = line.color,
                        onClose = controller::clearSelection,
                        onBack = if (shown.fromStationId != null) controller::backFromLine else null,
                        // TransJakarta has no line pages, as on the web.
                        onOpenPage = if (line.operator != OPERATOR_TJ) {
                            { navigator.goTo(Route.Line(line.operator, line.code, title = line.name, colorCode = line.color)) }
                        } else {
                            null
                        },
                        onOpenStation = openStation,
                        onOpenLine = openLine,
                        modifier = Modifier.fillMaxSize(),
                    )
                }

                MapSelection.Route -> routeSheet.Content(
                    fromId = mapRoute.fromId,
                    toId = mapRoute.toId,
                    journey = mapRoute.journey,
                    onPairChange = viewModel::setPair,
                    onOpenJourney = viewModel::openJourney,
                    onCloseJourney = viewModel::closeJourney,
                    onShown = viewModel::onShown,
                    onPickOnMap = { end ->
                        viewModel.arm(end)
                        controller.clearSelection()
                    },
                    // The trip runs, drawn on the map with the rider on it, its bar over the screen.
                    onTripStarted = {
                        viewModel.clearRoute()
                        controller.clearSelection()
                    },
                    onClose = controller::clearSelection,
                    modifier = Modifier.fillMaxSize(),
                )

                // Kept while it slides away for home's feed, rather than emptied as it goes.
                null -> if (home != null) {
                    Column(Modifier.fillMaxSize()) {
                        NearbyHeader(onClose = { mode = HomeMode.Feed })
                        home.nearby(nearbyIds, openStation)
                    }
                }
            }
        }

        // With no sheet up, as the web's phone corners: at the left the end being picked, the route
        // folded away, or the way into OTW; at the right the way back to the whole map and the credit.
        // On home, only once the map is being looked at or a pair is under way, and above the sheet.
        val homeRow = home == null || mode == HomeMode.Nearby || picking != null || mapRoute.isSet
        val sheetHeightPx = with(LocalDensity.current) { height.toPx() }
        if (selection == null && homeRow) {
            val bottom = WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding() + 24.dp
            AnimatedVisibility(
                visible = attributionOpen,
                enter = fadeIn(tween(CHOOSER_FADE_MILLIS)) + scaleIn(tween(CHOOSER_FADE_MILLIS), initialScale = 0.92f),
                exit = fadeOut(tween(CHOOSER_FADE_MILLIS)),
                modifier = Modifier
                    .align(Alignment.BottomEnd)
                    .padding(start = 16.dp, end = 16.dp, bottom = bottom + 56.dp),
            ) {
                if (streets) StreetsAttribution(busMap?.attribution) else Attribution(version = data.manifest.version)
            }
            Row(
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .offset {
                        val top = if (home != null) minOf(sheetState.offset, feedState.offset) else sheetHeightPx
                        IntOffset(0, -(sheetHeightPx - top).coerceAtLeast(0f).toInt())
                    }
                    .fillMaxWidth()
                    .padding(start = 16.dp, end = 16.dp, bottom = if (home != null) 12.dp else bottom),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(Modifier.weight(1f).chromeEnter(2)) {
                    val armed = picking
                    when {
                        armed != null -> PickPill(end = armed, onCancel = viewModel::disarm)

                        mapRoute.isSet -> routeSheet.Chip(
                            shown = mapRoute.shown?.takeIf { it.fromId == mapRoute.fromId && it.toId == mapRoute.toId }
                                ?: MapRouteShown(mapRoute.fromId, mapRoute.toId),
                            onOpen = controller::openRouteSheet,
                            onClear = viewModel::clearRoute,
                            modifier = Modifier,
                        )

                        else -> CommuteButton(
                            onClick = {
                                viewModel.disarm()
                                routeSheetFull = true
                                controller.openRouteSheet()
                            },
                        ) {
                            CommuteButtonIcon(CommuteIcons.Fare)
                            CommuteButtonText(stringResource(R.string.map_check_route))
                        }
                    }
                }
                // Faded in place rather than gone, so the credit beside it never jumps.
                val recenterShown by animateFloatAsState(if (zoomedIn || streets) 1f else 0f, tween(TITLE_FADE_MILLIS), label = "recenter")
                MapButton(
                    icon = if (streets) CommuteIcons.NavigationArrow else CommuteIcons.MapRecenter,
                    description = stringResource(if (streets) R.string.map_streets_recenter else R.string.map_recenter),
                    onClick = {
                        haptics.performHapticFeedback(HapticFeedbackType.ContextClick)
                        if (streets) streetsState.recenter() else controller.recenter()
                    },
                    modifier = Modifier
                        .chromeEnter(3)
                        .graphicsLayer {
                            alpha = recenterShown
                            fadeShadowsWhole()
                        },
                )
                MapButton(
                    icon = CommuteIcons.MapInfo,
                    description = stringResource(R.string.map_attribution_open),
                    onClick = {
                        layersOpen = false
                        attributionOpen = !attributionOpen
                    },
                    modifier = Modifier.chromeEnter(4),
                )
            }
        }

        // Back onto the rider once the map has been moved away from them.
        if (tripShown && !following && selection == null && picking == null && !streets) {
            // Above the row of buttons where it shows, else just above the sheet.
            val rowBottom = if (home != null) 12.dp else WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding() + 24.dp
            val lift = if (homeRow) rowBottom + 56.dp else 12.dp
            MapButton(
                icon = CommuteIcons.NavigationArrow,
                description = stringResource(R.string.map_follow_rider),
                onClick = {
                    haptics.performHapticFeedback(HapticFeedbackType.ContextClick)
                    controller.followRider()
                },
                modifier = Modifier
                    .align(Alignment.BottomEnd)
                    .offset {
                        val top = if (home != null) minOf(sheetState.offset, feedState.offset) else sheetHeightPx
                        IntOffset(0, -(sheetHeightPx - top).coerceAtLeast(0f).toInt())
                    }
                    .padding(end = 16.dp, bottom = lift),
            )
        }

        // Held through its exit, which has no choices left to show.
        var heldChoices by remember { mutableStateOf(lineChoices) }
        LaunchedEffect(lineChoices) {
            if (lineChoices.isNotEmpty()) heldChoices = lineChoices
        }
        val localDensity = LocalDensity.current
        val heightPx = with(localDensity) { height.toPx() }
        val chooserLift = with(localDensity) { CHOOSER_BOTTOM.toPx() }
        val chooserGap = with(localDensity) { CHOOSER_SHEET_GAP.toPx() }
        AnimatedVisibility(
            visible = lineChoices.isNotEmpty(),
            enter = fadeIn(tween(CHOOSER_FADE_MILLIS)) + scaleIn(tween(CHOOSER_FADE_MILLIS), initialScale = 0.95f),
            exit = fadeOut(tween(CHOOSER_FADE_MILLIS)),
            modifier = Modifier
                .align(Alignment.BottomCenter)
                // Where the web floats it, or over the sheet when one is up.
                .offset { IntOffset(0, -maxOf(chooserLift, heightPx - sheetState.offset + chooserGap).toInt()) }
                .padding(horizontal = 16.dp),
        ) {
            LineChooser(lines = heldChoices.ifEmpty { lineChoices }, onChoose = controller::chooseLine)
        }

        // The layers card, under its button, over the sheet.
        AnimatedVisibility(
            visible = layersOpen,
            enter = fadeIn(tween(CHOOSER_FADE_MILLIS)) + scaleIn(tween(CHOOSER_FADE_MILLIS), initialScale = 0.92f, transformOrigin = TransformOrigin(1f, 0f)),
            exit = fadeOut(tween(CHOOSER_FADE_MILLIS)),
            modifier = Modifier
                .align(Alignment.TopEnd)
                .padding(top = topInset + if (home == null) LAYERS_CARD_TOP else LAYERS_CARD_TOP_HOME, end = 16.dp),
        ) {
            LayerPicker(
                streets = streetsPicked,
                onPick = { picked ->
                    haptics.performHapticFeedback(HapticFeedbackType.ContextClick)
                    viewModel.pickStreets(picked)
                    if (!picked) layersOpen = false
                },
            )
        }

        // The debug panel, under its button, over the sheet.
        AnimatedVisibility(
            visible = debugOpen,
            enter = fadeIn(tween(CHOOSER_FADE_MILLIS)) + scaleIn(tween(CHOOSER_FADE_MILLIS), initialScale = 0.92f, transformOrigin = TransformOrigin(1f, 0f)),
            exit = fadeOut(tween(CHOOSER_FADE_MILLIS)),
            modifier = Modifier
                .align(Alignment.TopEnd)
                .padding(top = topInset + if (home == null) DEBUG_CARD_TOP else DEBUG_CARD_TOP_HOME, end = 16.dp),
        ) {
            MapDebugPanel(
                lines = streetsLines,
                onLines = { lines ->
                    haptics.performHapticFeedback(HapticFeedbackType.ContextClick)
                    viewModel.showLines(lines)
                },
                dots = streetsDots,
                onDots = { dots ->
                    haptics.performHapticFeedback(HapticFeedbackType.ContextClick)
                    viewModel.showDots(dots)
                },
                overview = streetsOverview,
                onOverview = { overview ->
                    haptics.performHapticFeedback(HapticFeedbackType.ContextClick)
                    viewModel.showOverview(overview)
                },
                apart = streetsApart,
                onApart = { apart ->
                    haptics.performHapticFeedback(HapticFeedbackType.ContextClick)
                    viewModel.showApart(apart)
                },
                joins = streetsJoins,
                onJoins = { joins ->
                    haptics.performHapticFeedback(HapticFeedbackType.ContextClick)
                    viewModel.showJoins(joins)
                },
                weight = streetsWeight,
                onWeight = { weight ->
                    haptics.performHapticFeedback(HapticFeedbackType.ContextClick)
                    viewModel.showWeight(weight)
                },
                city = streetsCity,
                onCity = { city ->
                    haptics.performHapticFeedback(HapticFeedbackType.ContextClick)
                    viewModel.showCity(city)
                },
            )
        }
    }
}

/**
 * [StreetsMap] where a surface can be: not while a shared transition runs (the morph out of home's
 * card, a page over the map coming or going), which a SurfaceView can't be faded or clipped with,
 * as the artwork's surface isn't. The basemap's land colour stands in meanwhile.
 */
@Composable
private fun StreetsLayer(
    state: StreetsMapState,
    styleUrl: String,
    busMap: BusMapLayer?,
    dark: Boolean,
    onStationTap: (String) -> Unit,
    onTap: () -> Unit,
    onUserMove: () -> Unit,
    onLineTap: (List<String>) -> Unit,
    isolated: String?,
    lines: StreetsLines,
    feed: String?,
    dots: StreetsDots,
    overview: StreetsOverview,
    apart: StreetsApart,
    city: StreetsCity,
    weight: StreetsWeight,
    joins: StreetsJoins,
) {
    val description = stringResource(R.string.map_streets_description)
    val transitioning = LocalSharedTransitionScope.current?.isTransitionActive == true
    Box(
        Modifier
            .fillMaxSize()
            .background(if (dark) StreetsStandInDark else StreetsStandIn)
            .semantics { contentDescription = description },
    ) {
        if (!transitioning) {
            StreetsMap(
                state = state,
                styleUrl = styleUrl,
                busMap = busMap,
                dark = dark,
                onStationTap = onStationTap,
                onTap = onTap,
                onUserMove = onUserMove,
                onLineTap = onLineTap,
                isolated = isolated,
                lines = lines,
                feed = feed,
                dots = dots,
                overview = overview,
                apart = apart,
                city = city,
                weight = weight,
                joins = joins,
                modifier = Modifier.fillMaxSize(),
            )
        }
    }
}

/**
 * A line picked on the streets with no sheet of its own on the artwork (an Angkutan Umum Integrasi
 * line, a branch): its roundel, its name, and a way back to all of them.
 */
@Composable
private fun StreetsLinePill(line: BusMapLineInfo, onClose: () -> Unit, modifier: Modifier = Modifier) {
    Surface(
        modifier = modifier.widthIn(max = 360.dp),
        shape = RoundedCornerShape(percent = 50),
        color = MaterialTheme.colorScheme.surfaceContainerLowest,
        shadowElevation = 6.dp,
    ) {
        Row(
            modifier = Modifier.padding(start = 8.dp, top = 6.dp, end = 6.dp, bottom = 6.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            LineRoundel(code = line.code, color = line.color, operator = OPERATOR_TJ, size = RoundelSize.SM)
            Text(
                text = line.name,
                modifier = Modifier.weight(1f, fill = false),
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.Bold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            CommuteCloseButton(onClick = onClose, contentDescription = stringResource(R.string.map_streets_line_close))
        }
    }
}

/** The streets layer's credit: the basemap's data and Peta Bus's. */
@Composable
private fun StreetsAttribution(busMapCredit: String?, modifier: Modifier = Modifier) {
    val title = stringResource(R.string.map_streets_attribution_title)
    Surface(
        modifier = modifier
            .widthIn(max = 320.dp)
            .semantics { paneTitle = title },
        shape = RoundedCornerShape(12.dp),
        color = MaterialTheme.colorScheme.surfaceContainerLowest,
        border = BorderStroke(1.dp, Slate200),
        shadowElevation = 12.dp,
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(text = title, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
            Text(text = stringResource(R.string.map_streets_attribution_credit), style = MaterialTheme.typography.bodySmall, color = Slate600)
            if (busMapCredit != null) Text(text = busMapCredit, style = MaterialTheme.typography.bodySmall, color = Slate500)
        }
    }
}

/** "Pilih stasiun keberangkatan": an end armed, the next station tapped on the map filling it. */
@Composable
private fun PickPill(end: PairEnd, onCancel: () -> Unit, modifier: Modifier = Modifier) {
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(percent = 50),
        color = MaterialTheme.colorScheme.surfaceContainerLowest,
        shadowElevation = 6.dp,
    ) {
        Row(
            modifier = Modifier.padding(start = 20.dp, top = 6.dp, end = 8.dp, bottom = 6.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = stringResource(if (end == PairEnd.ORIGIN) R.string.map_pick_origin else R.string.map_pick_destination),
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.Bold,
            )
            CommuteCloseButton(onClick = onCancel, contentDescription = stringResource(R.string.map_pick_cancel))
        }
    }
}

/**
 * The lines sharing the stroke a tap landed on, the web's "Ada beberapa lin di sini": an
 * interlined trunk carries several, and the geometry can't say which was meant.
 */
@Composable
private fun LineChooser(lines: List<MapLine>, onChoose: (lineKey: String) -> Unit, modifier: Modifier = Modifier) {
    val title = stringResource(R.string.map_line_choices_title)
    Surface(
        modifier = modifier
            .widthIn(max = 320.dp)
            .semantics { paneTitle = title },
        shape = RoundedCornerShape(12.dp),
        color = MaterialTheme.colorScheme.surfaceContainerLowest,
        border = BorderStroke(1.dp, Slate200),
        shadowElevation = 12.dp,
    ) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(
                text = stringResource(R.string.map_line_choices),
                style = MaterialTheme.typography.bodySmall,
                color = Slate600,
            )
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                for (line in lines) {
                    key(line.key) {
                        Row(
                            modifier = Modifier
                                .clip(RoundedCornerShape(8.dp))
                                .background(Slate100)
                                .clickable(role = Role.Button) { onChoose(line.key) }
                                .padding(horizontal = 12.dp, vertical = 8.dp),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            LineRoundel(code = line.code, color = line.color, operator = line.operator, size = RoundelSize.SM)
                            Text(
                                text = line.name.removePrefix("Lin "),
                                style = MaterialTheme.typography.bodyMedium,
                                fontWeight = FontWeight.SemiBold,
                                color = MaterialTheme.colorScheme.onSurface,
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun MapSurface(controller: MapController, viewModel: MapViewModel) {
    val supported by controller.isSupported.collectAsStateWithLifecycle()
    val snapshot by controller.snapshot.collectAsStateWithLifecycle()
    val showHitboxes by viewModel.showHitboxes.collectAsStateWithLifecycle()
    SideEffect { controller.showHitboxes = showHitboxes }
    val scope = rememberCoroutineScope()
    val description = stringResource(R.string.map_description)

    // The controller stays with the view model while the map is on the back stack; what a later
    // opening of the map starts from is kept as the screen goes, in case it doesn't come back.
    DisposableEffect(controller) {
        onDispose {
            viewModel.session.camera = controller.camera
            viewModel.session.snapshot = controller.snapshot.value
        }
    }

    // Frames only while something moves or arrives; a still map draws nothing.
    LaunchedEffect(controller) {
        while (true) {
            controller.awaitInvalidation()
            while (withFrameNanos(controller::frame)) {
                // The next frame's step is already decided by this one.
            }
        }
    }

    // A while in the background and the tiles' memory goes back, as the web lets it go; back before
    // then and nothing is let go.
    var release by remember { mutableStateOf<Job?>(null) }
    LifecycleStartEffect(controller) {
        release?.cancel()
        release = null
        onStopOrDispose {
            release = scope.launch {
                delay(BACKGROUND_RELEASE_MS)
                controller.releaseTiles()
            }
        }
    }

    if (!supported) {
        Text(
            text = stringResource(R.string.map_unsupported),
            modifier = Modifier.fillMaxSize().padding(32.dp),
            style = MaterialTheme.typography.bodyLarge,
            color = Color.Black,
        )
        return
    }

    // A surface can't be faded or clipped with the window's layers, and the hole the window cuts for
    // it showed the live map, then black, through the morph's landing crossfade. So the surface is
    // only there while no shared transition runs (a back gesture, cancelled or not, ends with none
    // running), and something drawn in the window stands in for it meanwhile: until the open has
    // landed, through every transition, and until the surface shows every tile: the map's last
    // snapshot, white before the first one.
    val transition = LocalNavAnimatedVisibilityScope.current?.transition
    val shared = LocalSharedTransitionScope.current
    var landed by remember { mutableStateOf(transition == null) }
    LaunchedEffect(transition?.currentState, transition?.targetState) {
        if (transition?.currentState == EnterExitState.Visible && transition.targetState == EnterExitState.Visible) {
            landed = true
        }
    }
    val transitioning = shared?.isTransitionActive == true
    val mounted = landed && !transitioning
    val showing by controller.isShowing.collectAsStateWithLifecycle()
    // Tiles slow to arrive, offline say, don't hold the map back: what's drawn shows after a while.
    var waitedEnough by remember { mutableStateOf(false) }
    LaunchedEffect(mounted) {
        waitedEnough = false
        if (mounted) {
            delay(STAND_IN_MAX_WAIT_MS)
            waitedEnough = true
        }
    }
    val standingIn = !mounted || (!showing && !waitedEnough)
    val standInAlpha by animateFloatAsState(
        targetValue = if (standingIn) 1f else 0f,
        animationSpec = if (standingIn) snap() else tween(STAND_IN_FADE_MILLIS),
        label = "standIn",
    )

    Box(Modifier.fillMaxSize().semantics { contentDescription = description }) {
        // A SurfaceView, so the system composites the frames itself. Behind a TextureView they waited
        // on the window's own redraws, and on a Galaxy S23 only about half of them reached the
        // screen. The cost: nothing in the window, a frosted sheet say, can blur the map.
        if (mounted) {
            AndroidExternalSurface(modifier = Modifier.fillMaxSize(), isOpaque = true) {
                onSurface { surface, width, height ->
                    controller.onSurface(surface, width, height)
                    surface.onChanged { newWidth, newHeight -> controller.onResize(newWidth, newHeight) }
                    surface.onDestroyed { controller.onSurfaceDestroyed() }
                }
            }
        }
        if (standInAlpha > 0f) {
            Box(
                Modifier
                    .fillMaxSize()
                    .graphicsLayer { alpha = standInAlpha }
                    .background(Color.White),
            ) {
                snapshot?.let {
                    Image(
                        bitmap = it.asImageBitmap(),
                        contentDescription = null,
                        modifier = Modifier.fillMaxSize(),
                        contentScale = ContentScale.FillBounds,
                    )
                }
            }
        }
        // Over the surface rather than on it, so every touch reaches the camera first.
        Box(
            Modifier
                .fillMaxSize()
                .pointerInput(controller) {
                    awaitPointerEventScope {
                        while (true) {
                            val event = awaitPointerEvent()
                            if (event.type == PointerEventType.Exit) continue
                            for (change in event.changes) {
                                val id = change.id.value
                                val (x, y) = change.position
                                when {
                                    change.changedToDownIgnoreConsumed() -> controller.onPointerDown(id, x, y, change.uptimeMillis)
                                    // Compose lifts a cancelled touch already consumed, as when a
                                    // back swipe from the edge takes it: no tap where it landed.
                                    change.changedToUpIgnoreConsumed() && change.isConsumed -> controller.onPointerCancel()
                                    change.changedToUpIgnoreConsumed() -> controller.onPointerUp(id, x, y, change.uptimeMillis)
                                    change.positionChanged() -> controller.onPointerMove(id, x, y, change.uptimeMillis)
                                }
                                change.consume()
                            }
                        }
                    }
                },
        )
    }
}

/**
 * The renderer lost and not made again after every try, the web's "Peta terputus": what the
 * surface shows is no use, so it is covered, with a way to try again.
 */
@Composable
private fun MapLost(onRetry: () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(LostBackground)
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text(
            text = stringResource(R.string.map_lost_title),
            style = MaterialTheme.typography.titleLarge,
            fontWeight = FontWeight.SemiBold,
            color = Color(0xFF1E293B),
        )
        Text(
            text = stringResource(R.string.map_lost_body),
            modifier = Modifier.padding(top = 4.dp),
            style = MaterialTheme.typography.bodyMedium,
            color = Color(0xFF64748B),
        )
        CommuteButton(onClick = onRetry, modifier = Modifier.padding(top = 24.dp)) {
            CommuteButtonText(stringResource(R.string.map_lost_retry))
        }
    }
}

/** Behind "Peta terputus", the web's. */
private val LostBackground = Color(0xFFFFF8F8)

/** The web's ripple: slate-400 at 60%, a 40 px ring from 0.3× to 2.2×, fading from 0.7. */
private val RippleColor = Color(0x9994A3B8)
private val RIPPLE_RADIUS = 20.dp
private val RIPPLE_STROKE = 2.dp
private const val RIPPLE_SCALE_FROM = 0.3f
private const val RIPPLE_SCALE_TO = 2.2f
private const val RIPPLE_OPACITY = 0.7f
private const val RIPPLE_MILLIS = 350

/** The web's chrome entrance, and the pill's fade. */
private const val CHROME_ENTER_MILLIS = 300
private const val CHROME_STAGGER_MILLIS = 50L
private val CHROME_ENTER_RISE = 8.dp
private const val TITLE_FADE_MILLIS = 200

/** The sheet's top corners. */
private val SHEET_CORNER = 24.dp

/** What full leaves showing under the status bar. */
private val SHEET_TOP_GAP = 8.dp

/** The line chooser's lift off the foot of the map, the web's `bottom-24`, and off a sheet. */
private val CHOOSER_BOTTOM = 96.dp
private val CHOOSER_SHEET_GAP = 16.dp
private const val CHOOSER_FADE_MILLIS = 150

/** Behind the status bar over the map. */
private val StatusBarNavy = Color(0xFF001421)

/** The scrim's opacity at the top edge, fading to none at its foot. */
private const val STATUS_SCRIM_ALPHA = 0.85f

/** How far down the scrim reaches, in status bar heights. */
private const val STATUS_SCRIM_REACH = 1.5f

/** Stops along the scrim: enough that the eased curve reads as a curve, not as bands. */
private const val STATUS_SCRIM_STOPS = 16

/**
 * The scrim's fade, eased rather than linear: a cosine, flat at both ends, so it neither starts
 * with a step under the clock nor stops on a visible line where it meets the map.
 */
private val StatusScrim = Brush.verticalGradient(
    *Array(STATUS_SCRIM_STOPS + 1) { i ->
        val t = i.toFloat() / STATUS_SCRIM_STOPS
        t to StatusBarNavy.copy(alpha = STATUS_SCRIM_ALPHA * (1 + cos(PI.toFloat() * t)) / 2)
    },
)

/** How long the snapshot takes to give way to the live map once the screen has landed. */
private const val STAND_IN_FADE_MILLIS = 150

/** The longest the stand-in waits for every tile before the live map shows anyway. */
private const val STAND_IN_MAX_WAIT_MS = 800L

/** How long the map waits in the background before letting its tiles go: the web's 3 s. */
private const val BACKGROUND_RELEASE_MS = 3_000L

/** The layers button under the close (8 dp down, 40 dp tall, a 12 dp gap), and its card under that. */
private val LAYERS_BUTTON_TOP = 60.dp
private val LAYERS_CARD_TOP = 112.dp

/** On home, with no close: the layers button where the close would be, its card under it. */
private val LAYERS_BUTTON_TOP_HOME = 8.dp
private val LAYERS_CARD_TOP_HOME = 60.dp

/** The debug button under the layers button (40 dp tall, a 12 dp gap), and its panel under that. */
private val DEBUG_BUTTON_TOP = LAYERS_BUTTON_TOP + 52.dp
private val DEBUG_CARD_TOP = LAYERS_CARD_TOP + 52.dp
private val DEBUG_BUTTON_TOP_HOME = LAYERS_BUTTON_TOP_HOME + 52.dp
private val DEBUG_CARD_TOP_HOME = LAYERS_CARD_TOP_HOME + 52.dp

/** A line picked on the streets: the pill naming it, under the title, and the margin it's framed with. */
private val LINE_PILL_TOP = 60.dp
private val LINE_FRAME_EDGE = 48.dp

/** How many stations "Sekitar" lists for the panned streets, as many as for the artwork. */
private const val STREETS_IN_VIEW = 6

/** shirase's land colours, light and dark: what the streets layer shows before its first frame. */
private val StreetsStandIn = Color(0xFFE2DFDA)
private val StreetsStandInDark = Color(0xFF34373D)

/** What home on the map hands in: its feed, its list of stations in view, and its rail. */
internal class HomeSlots(
    val feed: @Composable (openStation: (stationId: String) -> Unit) -> Unit,
    val nearby: @Composable (stationIds: List<String>, openStation: (stationId: String) -> Unit) -> Unit,
    val rail: @Composable BoxScope.() -> Unit,
    val riderNear: List<NearStation>?,
    /** The feed's sheet, made before the map had loaded and kept as it does. */
    val feedState: MapSheetState? = null,
)

/** What home's sheet shows with nothing selected: its feed, or the stations in view once panned. */
private enum class HomeMode { Feed, Nearby }

/**
 * Home on the map, the Experimental prototype: the map's own sheet, with home's feed in it resting
 * part way up, and no way back, home being the root.
 */
@Composable
internal fun MapHomeScreen(
    innerPadding: PaddingValues,
    slots: HomeSlots,
    stationSheet: StationSheet,
    hubSheet: HubSheet,
    lineSheet: LineSheet,
    routeSheet: MapRouteSheet,
    modifier: Modifier = Modifier,
    viewModel: MapViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val navigator = LocalNavigator.current
    // The feed and the rail are home's whether the map has loaded or not: up from the first frame,
    // and moved whole (scroll, boards and all) into the map's layout once it has, rather than made
    // again there.
    val latest by rememberUpdatedState(slots)
    val feed = remember { movableContentOf { open: (String) -> Unit -> latest.feed(open) } }
    val rail = remember { movableContentWithReceiverOf<BoxScope> { latest.rail(this) } }
    val feedState = rememberMapSheetState(onHiding = {}, initial = SheetStop.Rest)
    Box(modifier.fillMaxSize().background(Color.White)) {
        when (val current = state) {
            is UIState.Success -> MapWithSheet(
                data = current.data,
                route = Route.Map(),
                viewModel = viewModel,
                innerPadding = innerPadding,
                stationSheet = stationSheet,
                hubSheet = hubSheet,
                lineSheet = lineSheet,
                routeSheet = routeSheet,
                home = HomeSlots(feed = feed, nearby = slots.nearby, rail = rail, riderNear = slots.riderNear, feedState = feedState),
            )

            // The map still coming, or not come: the feed works meanwhile, a station opening as a page.
            else -> BoxWithConstraints(Modifier.fillMaxSize()) {
                Box(
                    Modifier.fillMaxWidth().height(maxHeight * (1 - HOME_REST_FRACTION).toFloat()),
                    contentAlignment = Alignment.Center,
                ) {
                    if (current is UIState.Error) {
                        ProblemPanel(
                            message = stringResource(R.string.map_load_failed),
                            retryLabel = stringResource(R.string.map_retry),
                            onRetry = viewModel::retry,
                            modifier = Modifier.padding(top = innerPadding.calculateTopPadding()).padding(24.dp),
                        )
                    } else {
                        CircularProgressIndicator(Modifier.padding(top = innerPadding.calculateTopPadding()))
                    }
                }
                MapChrome(innerPadding, onBack = null)
                HomeFeedSheet(
                    state = feedState,
                    screenHeight = maxHeight,
                    topInset = innerPadding.calculateTopPadding(),
                    // Nothing under it to send it away for yet.
                    stops = HomeFeedLoadingStops,
                ) {
                    feed { stationId -> navigator.goTo(Route.Station(stationId)) }
                }
                Box(Modifier.align(Alignment.BottomCenter).fillMaxWidth()) { rail() }
            }
        }
    }
}

/** Home's feed in its sheet, the map's own sheet's shape, resting over [HOME_REST_FRACTION] of the screen. */
@Composable
private fun HomeFeedSheet(
    state: MapSheetState,
    screenHeight: Dp,
    topInset: Dp,
    stops: Set<SheetStop>,
    content: @Composable () -> Unit,
) {
    MapSheet(
        state = state,
        screenHeight = screenHeight,
        height = screenHeight - topInset - SHEET_TOP_GAP,
        peek = screenHeight * Viewport.PEEK_FRACTION.toFloat(),
        fullTop = topInset + SHEET_TOP_GAP,
        shape = RoundedCornerShape(topStart = SHEET_CORNER, topEnd = SHEET_CORNER),
        color = MaterialTheme.colorScheme.surfaceContainerLowest,
        shadowElevation = 8.dp,
        rest = screenHeight * HOME_REST_FRACTION.toFloat(),
        stops = stops,
        content = content,
    )
}

/** "Sekitar": over the stations in view, with the way back to home's feed. */
@Composable
private fun NearbyHeader(onClose: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            // On the station names' edge and the cards', the ✕'s glyph as far in from the right
            // (its 48dp target leaves 13dp round the 22dp glyph).
            .padding(start = 16.dp, top = 16.dp, end = 3.dp, bottom = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = stringResource(R.string.map_home_nearby_title),
            modifier = Modifier.weight(1f),
            style = MaterialTheme.typography.titleLarge,
            fontWeight = FontWeight.Bold,
        )
        CommuteIconButton(onClick = onClose) {
            Icon(
                imageVector = CommuteIcons.Close,
                contentDescription = stringResource(R.string.map_home_nearby_close),
                modifier = Modifier.size(22.dp),
                tint = MaterialTheme.colorScheme.onSurface,
            )
        }
    }
}

/** How much of the screen home's sheet covers at rest: the map shows over the rest. */
private const val HOME_REST_FRACTION = 0.55

/** Home's feed rests, goes full, or goes away below the screen for the map's sheet. */
private val HomeFeedStops = setOf(SheetStop.Full, SheetStop.Rest, SheetStop.Hidden)

/** Home's feed before the map has loaded: nothing under it to go away for. */
private val HomeFeedLoadingStops = setOf(SheetStop.Full, SheetStop.Rest)

/** The rail's slide off the foot of the screen with the feed, and back. */
private const val RAIL_SLIDE_MILLIS = 250

/** How long after the last pan the stations in view are looked up, and again for a fling's end. */
private const val NEARBY_SETTLE_MS = 300L
private const val NEARBY_FLING_MS = 700L
