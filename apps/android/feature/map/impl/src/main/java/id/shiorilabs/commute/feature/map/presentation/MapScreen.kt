package id.shiorilabs.commute.feature.map.presentation

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.EnterExitState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.foundation.AndroidExternalSurface
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
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
import androidx.compose.ui.graphics.Color
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
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.LifecycleStartEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import id.shiorilabs.commute.core.constants.OPERATOR_TJ
import id.shiorilabs.commute.core.navigation.LocalNavigator
import id.shiorilabs.commute.core.navigation.Route
import id.shiorilabs.commute.core.type.UIState
import id.shiorilabs.commute.core.ui.components.CommuteIconButton
import id.shiorilabs.commute.core.ui.components.LineRoundel
import id.shiorilabs.commute.core.ui.components.ProblemPanel
import id.shiorilabs.commute.core.ui.components.RoundelSize
import id.shiorilabs.commute.core.ui.icons.CommuteIcons
import id.shiorilabs.commute.core.ui.morph.LocalNavAnimatedVisibilityScope
import id.shiorilabs.commute.core.ui.morph.LocalSharedTransitionScope
import id.shiorilabs.commute.core.ui.morph.NavCardMorphTarget
import id.shiorilabs.commute.core.ui.theme.DarkStatusBarIcons
import id.shiorilabs.commute.core.ui.theme.Slate100
import id.shiorilabs.commute.core.ui.theme.Slate200
import id.shiorilabs.commute.core.ui.theme.Slate600
import id.shiorilabs.commute.feature.hub.presentation.HubSheet
import id.shiorilabs.commute.feature.line.presentation.LineSheet
import id.shiorilabs.commute.feature.map.R
import id.shiorilabs.commute.feature.map.domain.MapData
import id.shiorilabs.commute.feature.map.domain.MapLine
import id.shiorilabs.commute.feature.map.domain.MapSelection
import id.shiorilabs.commute.feature.map.domain.Viewport
import id.shiorilabs.commute.feature.station.presentation.StationSheet
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.PI
import kotlin.math.cos

/**
 * The FDTJ integration map, edge to edge under the system bars, with a way back over it, and a
 * sheet over it for the station, hub or line tapped, as the web's phone layout shows them.
 */
@Composable
fun MapScreen(
    innerPadding: PaddingValues,
    stationSheet: StationSheet,
    hubSheet: HubSheet,
    lineSheet: LineSheet,
    viewModel: MapViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val navigator = LocalNavigator.current

    // Grows out of home's white rail card, as the other rail screens do.
    NavCardMorphTarget(destination = Route.Map, cardTint = null) {
        // The artwork is drawn on white whatever the theme, as on the web.
        Box(Modifier.fillMaxSize().background(Color.White)) {
            when (val current = state) {
                is UIState.Success -> MapWithSheet(current.data, viewModel, innerPadding, stationSheet, hubSheet, lineSheet)
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

/** The status bar's scrim and the way back, over the map. */
@Composable
private fun MapChrome(innerPadding: PaddingValues, onBack: () -> Unit) {
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

    CommuteIconButton(
        onClick = onBack,
        modifier = Modifier
            .padding(top = innerPadding.calculateTopPadding() + 8.dp, start = 12.dp)
            .size(40.dp)
            .shadow(2.dp, CircleShape)
            .background(MaterialTheme.colorScheme.surface, CircleShape),
    ) {
        Icon(
            imageVector = CommuteIcons.Back,
            contentDescription = stringResource(R.string.map_back),
            modifier = Modifier.size(22.dp),
            tint = MaterialTheme.colorScheme.onSurface,
        )
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
    viewModel: MapViewModel,
    innerPadding: PaddingValues,
    stationSheet: StationSheet,
    hubSheet: HubSheet,
    lineSheet: LineSheet,
) {
    val navigator = LocalNavigator.current
    val density = LocalDensity.current.density
    val haptics = LocalHapticFeedback.current
    val controller = remember(data) { viewModel.controller(data, density) }
    SideEffect { controller.onHit = { haptics.performHapticFeedback(HapticFeedbackType.ContextClick) } }
    val selection by controller.selection.collectAsStateWithLifecycle()
    val lineChoices by controller.lineChoices.collectAsStateWithLifecycle()
    // Dragged or flicked away: the selection goes with it, the camera and spotlight leaving as the
    // sheet does rather than once it has gone.
    val sheetState = rememberMapSheetState(
        onHiding = { if (controller.selection.value != null) controller.clearSelection() },
    )

    // Up at its peek for a selection, away without one, and down to it for a line, which is drawn
    // on the map rather than in the sheet.
    val showsLine = selection is MapSelection.Line
    LaunchedEffect(selection != null, showsLine) {
        sheetState.moveTo(if (selection != null) SheetStop.Peek else SheetStop.Hidden)
    }
    BackHandler(enabled = selection != null) {
        if (showsLine) controller.backFromLine() else controller.clearSelection()
    }
    // Declared after, so it goes first.
    BackHandler(enabled = lineChoices.isNotEmpty()) { controller.dismissLineChoices() }

    val openStation = { stationId: String ->
        if (!controller.selectStation(stationId)) navigator.goTo(Route.Station(stationId))
    }
    val openLine = { lineKey: String ->
        if (!controller.isolateLine(lineKey)) {
            navigator.goTo(Route.Line(lineKey.substringBefore(':'), lineKey.substringAfter(':')))
        }
    }

    BoxWithConstraints(Modifier.fillMaxSize()) {
        val topInset = innerPadding.calculateTopPadding()
        val height = maxHeight
        Box(Modifier.fillMaxSize()) {
            MapSurface(controller, viewModel)
            MapChrome(innerPadding, onBack = { navigator.pop() })
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
                        onOtw = { navigator.goTo(Route.Otw(toId = shown.stationId)) },
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

                null -> Unit
            }
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
