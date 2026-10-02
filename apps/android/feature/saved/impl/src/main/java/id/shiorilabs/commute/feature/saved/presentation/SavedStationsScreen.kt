package id.shiorilabs.commute.feature.saved.presentation

import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.layout
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.chrisbanes.haze.HazeState
import dev.chrisbanes.haze.HazeStyle
import dev.chrisbanes.haze.HazeTint
import dev.chrisbanes.haze.hazeEffect
import dev.chrisbanes.haze.hazeSource
import dev.chrisbanes.haze.rememberHazeState
import id.shiorilabs.commute.core.navigation.LocalNavigator
import id.shiorilabs.commute.core.navigation.Route
import id.shiorilabs.commute.core.type.UIState
import id.shiorilabs.commute.core.ui.components.CommuteEmptyState
import id.shiorilabs.commute.core.ui.ext.cardEntrance
import id.shiorilabs.commute.core.ui.preview.CommutePreviewScaffold
import id.shiorilabs.commute.core.ui.time.rememberJakartaNow
import id.shiorilabs.commute.feature.saved.R
import id.shiorilabs.commute.feature.saved.presentation.components.HomeNavRail
import id.shiorilabs.commute.feature.saved.presentation.components.StationPlaceholder
import id.shiorilabs.commute.feature.saved.presentation.components.StationTimetable
import id.shiorilabs.commute.feature.saved.presentation.components.StationTitle
import java.time.LocalDateTime

@Composable
fun SavedStationsScreen(
    innerPadding: PaddingValues,
    viewModel: SavedStationsViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val navigator = LocalNavigator.current
    val now = rememberJakartaNow()
    LaunchedEffect(now) {
        viewModel.onClockTick(now)
    }

    SavedStationsContent(
        state = state,
        now = now,
        innerPadding = innerPadding,
        onRetry = viewModel::retry,
        onSearchClick = { navigator.goTo(Route.Search) },
        onSettingsClick = { navigator.goTo(Route.Settings) },
        onStationClick = { navigator.goTo(Route.Station(it)) },
    )
}

@Composable
private fun SavedStationsContent(
    state: UIState<SavedStationsUiState>,
    now: LocalDateTime,
    innerPadding: PaddingValues,
    onRetry: (stationId: String) -> Unit = {},
    onSearchClick: () -> Unit = {},
    onSettingsClick: () -> Unit = {},
    onStationClick: (stationId: String) -> Unit = {},
) {
    val coveredByPage = railSlidesWithPage()

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background),
    ) {
        when (state) {
            // Nothing is drawn while the list is read off disk: it resolves within a frame or two,
            // and a spinner that short only reads as a flicker.
            is UIState.Idle, is UIState.Loading -> Unit

            is UIState.Success -> if (state.data.cards.isEmpty()) {
                SavedStationsEmpty(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(innerPadding),
                )
            } else {
                StationFeed(
                    feed = state.data,
                    now = now,
                    innerPadding = innerPadding,
                    onRetry = onRetry,
                    onStationClick = onStationClick,
                    coveredByPage = coveredByPage,
                )
            }

            is UIState.Error -> {
                Text(
                    text = stringResource(R.string.saved_error_message),
                    modifier = Modifier
                        .align(Alignment.Center)
                        .padding(innerPadding)
                        .padding(16.dp),
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.onBackground,
                    textAlign = TextAlign.Center,
                )
            }
        }

        HomeNavRail(
            onSearchClick = onSearchClick,
            onSettingsClick = onSettingsClick,
            bottomInset = innerPadding.calculateBottomPadding(),
            slidesWithPage = coveredByPage,
            modifier = Modifier.align(Alignment.BottomCenter),
        )
    }
}

/** The content type of a station's title row, and of the placeholder that stands in for it. */
private const val TITLE_ROW = "station-title"

@Composable
private fun StationFeed(
    feed: SavedStationsUiState,
    now: LocalDateTime,
    innerPadding: PaddingValues,
    onRetry: (stationId: String) -> Unit,
    onStationClick: (stationId: String) -> Unit,
    coveredByPage: Boolean,
) {
    val listDescription = stringResource(R.string.saved_station_list_description)
    // The station whose page was last opened from here: its name is the one that flies home. Only
    // while that page is what covers home: coming back from search, nothing flies, and its title
    // must show whole with the rest of the feed.
    var openedId by rememberSaveable { mutableStateOf<String?>(null) }
    val opened = openedId.takeIf { coveredByPage }
    val openStation = { stationId: String ->
        openedId = stationId
        onStationClick(stationId)
    }
    val listState = rememberLazyListState()
    val hazeState = rememberHazeState()
    val statusBar = innerPadding.calculateTopPadding()

    // The rows, in list order, so a row index leads back to its station. A loaded station is a title
    // row then its cards; one still loading, or failed, is a single placeholder row standing in for
    // its title. Either way the first row of a station is its title row.
    val titleRows = remember(feed.cards) {
        var row = 0
        feed.cards.map { card ->
            val titleRow = row
            row += if (card.station is UIState.Success) 2 else 1
            titleRow to card
        }
    }

    var barTitleHeight by remember { mutableIntStateOf(0) }
    val stuck by remember(titleRows) {
        derivedStateOf {
            val layout = listState.layoutInfo
            stuckTitle(
                visibleTitles = layout.visibleItemsInfo
                    .filter { it.contentType == TITLE_ROW }
                    .map { TitleSlot(it.index, it.offset) },
                titleIndices = titleRows.map { it.first },
                firstVisibleIndex = listState.firstVisibleItemIndex,
                titleHeight = barTitleHeight,
            )
        }
    }
    val stuckCard = stuck?.let { current -> titleRows.firstOrNull { it.first == current.index }?.second }
    val stuckName = (stuckCard?.station as? UIState.Success)?.data?.name

    Box(Modifier.fillMaxSize()) {
        LazyColumn(
            state = listState,
            modifier = Modifier
                .fillMaxSize()
                .hazeSource(hazeState)
                .semantics { contentDescription = listDescription },
            // Under the status bar at rest, and clear of the rail at the bottom, which sits over the
            // feed's last card otherwise.
            contentPadding = PaddingValues(
                top = statusBar,
                bottom = innerPadding.calculateBottomPadding() + NavRailClearance,
            ),
        ) {
            titleRows.forEachIndexed { index, (row, card) ->
                val station = card.station
                if (station is UIState.Success) {
                    item(key = "saved-station-title:${card.stationId}", contentType = TITLE_ROW) {
                        // The bar shows this title while it is the current one; drawn twice, the copy
                        // in the list would blur behind the bar's. The bar's copy is then the one
                        // that flies into the station page.
                        val underBar = stuckName != null && stuck?.index == row
                        StationTitle(
                            stationId = card.stationId,
                            name = station.data.name,
                            shareName = !underBar,
                            opened = card.stationId == opened,
                            onClick = { openStation(card.stationId) },
                            modifier = Modifier
                                .cardEntrance(index)
                                .graphicsLayer { alpha = if (underBar) 0f else 1f },
                        )
                    }
                    item(key = "saved-station:${card.stationId}") {
                        StationTimetable(
                            card = card,
                            lineCount = station.data.lineKeys.size,
                            lines = feed.lines,
                            now = now,
                            onRetry = { onRetry(card.stationId) },
                            modifier = Modifier
                                .cardEntrance(index)
                                .padding(bottom = StationGap),
                        )
                    }
                } else {
                    // Keyed as the title that replaces it, not as the timetable. The list holds its
                    // place by the key at the top, so a placeholder sharing the timetable's key
                    // would scroll the feed down past the title the moment the station loads.
                    item(key = "saved-station-title:${card.stationId}", contentType = TITLE_ROW) {
                        StationPlaceholder(
                            station = station,
                            onRetry = { onRetry(card.stationId) },
                            modifier = Modifier
                                .cardEntrance(index)
                                .padding(bottom = StationGap),
                        )
                    }
                }
            }
        }

        StuckTitleBar(
            stationId = stuckCard?.stationId,
            name = stuckName,
            pushOffset = { stuck?.pushOffset ?: 0 },
            statusBar = statusBar,
            hazeState = hazeState,
            onTitleHeight = { barTitleHeight = it },
            // The bar covers the list's own copy of the title, so it takes the tap for it.
            opened = stuckCard != null && stuckCard.stationId == opened,
            onClick = stuckCard?.takeIf { stuckName != null }?.let { card -> { openStation(card.stationId) } },
        )
    }
}

/**
 * The bar over the feed: the current station's name, blurred over the cards passing under it,
 * reaching up behind the status bar. Solid at its top edge and clearing to pure blur halfway down,
 * so behind the clock it reads as the page itself and the blur shows where the title is.
 *
 * Drawn over the list rather than as a sticky header in it: a sticky header pins to the very top of
 * the list, so to clear the clock every title would have to carry the status bar's height, and the
 * stations would sit that much further apart.
 *
 * When the next station's title pushes in, only the name moves. The background stays put and its
 * bottom edge gives way to the incoming title, so that title arrives sharp and the blur never jumps:
 * moving the whole bar would slide its blurred half up behind the clock and snap the solid top back
 * the moment the next station took over.
 */
@Composable
private fun StuckTitleBar(
    stationId: String?,
    name: String?,
    pushOffset: () -> Int,
    statusBar: Dp,
    hazeState: HazeState,
    onTitleHeight: (Int) -> Unit,
    opened: Boolean,
    onClick: (() -> Unit)?,
) {
    val background = MaterialTheme.colorScheme.background
    val style = HazeStyle(
        backgroundColor = background,
        tint = HazeTint(TitleWash),
        blurRadius = TitleBlur,
        noiseFactor = 0f,
    )
    val density = LocalDensity.current
    val statusBarPx = with(density) { statusBar.roundToPx() }
    var fullHeight by remember { mutableIntStateOf(0) }

    // The name fades on the feed's entrance curve when the bar gains or loses one, rather than
    // popping: the first time a station loads under the bar, and when the feed empties.
    val nameAlpha by animateFloatAsState(
        targetValue = if (name == null) 0f else 1f,
        animationSpec = tween(NAME_FADE_MILLIS, easing = IosSpringEasing),
        label = "stuckTitleName",
    )
    // The last name shown, kept through the fade out.
    var shownName by remember { mutableStateOf(name.orEmpty()) }
    if (name != null) {
        shownName = name
    }

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .layout { measurable, constraints ->
                val placeable = measurable.measure(constraints)
                // Never above the status bar: that part is the page itself, whatever is arriving.
                val height = (placeable.height + pushOffset()).coerceIn(statusBarPx, placeable.height)
                layout(placeable.width, height) {
                    placeable.place(0, 0)
                }
            }
            .clipToBounds()
            .hazeEffect(hazeState, style) {
                // Blur only what is behind the bar, as CSS's backdrop-filter does. Haze's default
                // also captures a blur radius around it, which tints the bar with cards still below.
                expandLayerBounds = false
            }
            .drawBehind {
                // Against the bar's full height, so the fade holds still while the bottom gives way.
                drawRect(
                    Brush.verticalGradient(
                        0f to background,
                        1f to background.copy(alpha = 0f),
                        startY = 0f,
                        endY = fullHeight * TITLE_FADE_END,
                    ),
                )
            },
    ) {
        // Always laid out, so the bar's height is known before the first title reaches it.
        StationTitle(
            stationId = stationId.orEmpty(),
            name = shownName,
            topInset = statusBar,
            shareName = stationId != null && name != null,
            opened = opened,
            onClick = onClick,
            modifier = Modifier
                .onSizeChanged {
                    fullHeight = it.height
                    onTitleHeight(it.height - statusBarPx)
                }
                .graphicsLayer {
                    translationY = pushOffset().toFloat()
                    alpha = nameAlpha
                },
        )
    }
}

/** What covered the home screen last, saved so the way back can tell which it was. */
private enum class CoveredBy { MORPH, PAGE }

/**
 * Whether the rail's cards drop off the bottom edge as what's covering the home screen comes and
 * goes: yes for a page, so the rail isn't left fading in place under something that has nothing to
 * do with it; no for search, which opens out of the rail's own card, and that card has to stay put
 * for the morph to start from it and land back on it.
 *
 * Which one it is comes from the top of the stack while home is being covered. On the way back that
 * page has already been popped, so the answer is saved from then: it survives home leaving
 * composition while covered.
 */
@Composable
private fun railSlidesWithPage(): Boolean {
    val top = LocalNavigator.current.backStack.lastOrNull()
    var coveredBy by rememberSaveable { mutableStateOf(CoveredBy.PAGE) }
    val current = when (top) {
        null, Route.Home -> coveredBy
        Route.Search, Route.Settings -> CoveredBy.MORPH
        else -> CoveredBy.PAGE
    }
    SideEffect { coveredBy = current }
    return current == CoveredBy.PAGE
}

/** The rail's cards plus their padding: what the feed's last card has to scroll clear of. */
private val NavRailClearance = 168.dp

/** Between one station's last card and the next station's name, the web's `gap-5`. */
private val StationGap = 20.dp

/** A stuck title's wash over the blur, the web's `bg-rose-50/20`. */
private val TitleWash = Color(0x33FFF1F2)

/** The web's `backdrop-blur-2xl`. */
private val TitleBlur = 40.dp

/** How far down a title's bar its solid top has cleared to pure blur. */
private const val TITLE_FADE_END = 0.5f

/** The bar's name fading in or out, as long as a card's entrance. */
private const val NAME_FADE_MILLIS = 300

/** The web's --ease-ios-spring, the feed's own curve. */
private val IosSpringEasing = CubicBezierEasing(0.36f, 0.66f, 0.04f, 1f)

@Composable
private fun SavedStationsEmpty(
    modifier: Modifier = Modifier,
) {
    val searchLabel = stringResource(R.string.saved_nav_search_title)

    CommuteEmptyState(
        illustration = painterResource(R.drawable.img_station),
        illustrationDescription = stringResource(R.string.saved_empty_illustration_description),
        title = stringResource(R.string.saved_empty_title),
        body = stringResource(R.string.saved_empty_body, searchLabel).withBold(searchLabel),
        modifier = modifier.padding(8.dp),
    )
}

@Preview(showBackground = true)
@Composable
private fun SavedStationsEmptyPreview() {
    CommutePreviewScaffold {
        SavedStationsContent(
            state = UIState.Success(SavedStationsUiState(cards = emptyList(), lines = emptyMap())),
            now = LocalDateTime.of(2026, 10, 1, 8, 0),
            innerPadding = PaddingValues(),
        )
    }
}
