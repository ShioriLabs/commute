package id.shiorilabs.commute.feature.saved.presentation

import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
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
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.graphicsLayer
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
import dev.chrisbanes.haze.hazeSource
import dev.chrisbanes.haze.rememberHazeState
import id.shiorilabs.commute.core.navigation.LocalNavigator
import id.shiorilabs.commute.core.navigation.Route
import id.shiorilabs.commute.core.type.UIState
import id.shiorilabs.commute.core.ui.components.CommuteEmptyState
import id.shiorilabs.commute.core.ui.components.NoticeBanner
import id.shiorilabs.commute.core.ui.ext.RevealInsertedTop
import id.shiorilabs.commute.core.ui.ext.cardEntrance
import id.shiorilabs.commute.core.ui.frost.FrostedTopChromeBackdrop
import id.shiorilabs.commute.core.ui.layout.TitleSlot
import id.shiorilabs.commute.core.ui.layout.stuckTitle
import id.shiorilabs.commute.core.ui.network.rememberIsOffline
import id.shiorilabs.commute.core.ui.preview.CommutePreviewScaffold
import id.shiorilabs.commute.core.ui.time.rememberJakartaNow
import id.shiorilabs.commute.feature.journey.presentation.SavedRouteCard
import id.shiorilabs.commute.feature.saved.R
import id.shiorilabs.commute.feature.saved.presentation.components.HomeNavRail
import id.shiorilabs.commute.feature.saved.presentation.components.RouteTitle
import id.shiorilabs.commute.feature.saved.presentation.components.StationPlaceholder
import id.shiorilabs.commute.feature.saved.presentation.components.StationTimetable
import id.shiorilabs.commute.feature.saved.presentation.components.StationTitle
import java.time.LocalDateTime

@Composable
fun SavedStationsScreen(
    innerPadding: PaddingValues,
    savedRouteCard: SavedRouteCard,
    viewModel: SavedStationsViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val navigator = LocalNavigator.current
    val now = rememberJakartaNow()
    val offline by rememberIsOffline()
    LaunchedEffect(now) {
        viewModel.onClockTick(now)
    }

    SavedStationsContent(
        state = state,
        now = now,
        innerPadding = innerPadding,
        offline = offline,
        onRetry = viewModel::retry,
        onSearchClick = { navigator.goTo(Route.Search) },
        onSettingsClick = { navigator.goTo(Route.Settings) },
        onStationClick = { navigator.goTo(Route.Station(it)) },
        onRouteClick = { fromId, toId -> navigator.goTo(Route.Journey(fromId = fromId, toId = toId)) },
        savedRouteCard = savedRouteCard,
    )
}

@Composable
private fun SavedStationsContent(
    state: UIState<SavedStationsUiState>,
    now: LocalDateTime,
    innerPadding: PaddingValues,
    offline: Boolean = false,
    onRetry: (stationId: String) -> Unit = {},
    onSearchClick: () -> Unit = {},
    onSettingsClick: () -> Unit = {},
    onStationClick: (stationId: String) -> Unit = {},
    onRouteClick: (fromId: String, toId: String) -> Unit = { _, _ -> },
    savedRouteCard: SavedRouteCard = NoSavedRouteCard,
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

            is UIState.Success -> if (state.data.entries.isEmpty()) {
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(innerPadding),
                ) {
                    if (offline) {
                        OfflineBanner(Modifier.padding(top = 32.dp))
                    }
                    SavedStationsEmpty(
                        modifier = Modifier
                            .fillMaxWidth()
                            .weight(1f),
                    )
                }
            } else {
                StationFeed(
                    feed = state.data,
                    now = now,
                    innerPadding = innerPadding,
                    offline = offline,
                    onRetry = onRetry,
                    onStationClick = onStationClick,
                    onRouteClick = onRouteClick,
                    savedRouteCard = savedRouteCard,
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

/**
 * The content type of an entry's title row (a station's name, a pair's "Dari → Ke") and of the
 * placeholder that stands in for a station's.
 */
private const val TITLE_ROW = "entry-title"

/** What the bar over the feed shows for an entry: a station's name, or a pair's two. */
private sealed interface BarTitle {

    data class Station(val stationId: String, val name: String) : BarTitle

    data class Pair(val fromId: String, val toId: String, val fromName: String?, val toName: String?) : BarTitle
}

/** A station has a title once it has loaded; a pair always has one, its names filling in. */
private fun HomeEntry.barTitle(): BarTitle? = when (this) {
    is HomeEntry.StationEntry -> (board.station as? UIState.Success)?.data?.let { BarTitle.Station(board.stationId, it.name) }
    is HomeEntry.RouteEntry -> BarTitle.Pair(fromId, toId, fromName, toName)
}

/** Previews have no journey feature to draw a pair's card. */
private object NoSavedRouteCard : SavedRouteCard {

    @Composable
    override fun Content(fromId: String, toId: String, modifier: Modifier) = Unit
}

@Composable
private fun StationFeed(
    feed: SavedStationsUiState,
    now: LocalDateTime,
    innerPadding: PaddingValues,
    offline: Boolean,
    onRetry: (stationId: String) -> Unit,
    onStationClick: (stationId: String) -> Unit,
    onRouteClick: (fromId: String, toId: String) -> Unit,
    savedRouteCard: SavedRouteCard,
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
    listState.RevealInsertedTop(offline)
    val hazeState = rememberHazeState()
    val density = LocalDensity.current
    // Off its rest position, the feed has something under the bar for the frost to blur.
    val scrolled by remember {
        derivedStateOf { listState.firstVisibleItemIndex > 0 || listState.firstVisibleItemScrollOffset > 0 }
    }
    val statusBar = innerPadding.calculateTopPadding()

    // The rows, in list order, so a row index leads back to its entry. A loaded station is a title
    // row then its cards; one still loading, or failed, is a single placeholder row standing in for
    // its title. A pair is its title row then its card. Either way the first row of an entry is its
    // title row. The offline banner, while it shows, is a row above them all.
    val titleRows = remember(feed.entries, offline) {
        var row = if (offline) 1 else 0
        feed.entries.map { entry ->
            val titleRow = row
            row += when (entry) {
                is HomeEntry.StationEntry -> if (entry.board.station is UIState.Success) 2 else 1
                is HomeEntry.RouteEntry -> 2
            }
            titleRow to entry
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
    val stuckEntry = stuck?.let { current -> titleRows.firstOrNull { it.first == current.index }?.second }
    val stuckTitle = stuckEntry?.barTitle()
    // The title sliding into the bar while it pushes the current one out, if it has one to show.
    val incoming = stuck?.takeIf { it.pushOffset < 0 }
        ?.let { current -> titleRows.firstOrNull { it.first > current.index } }
        ?.takeIf { it.second.barTitle() != null }
    val openTitle = { title: BarTitle ->
        when (title) {
            is BarTitle.Station -> openStation(title.stationId)
            is BarTitle.Pair -> onRouteClick(title.fromId, title.toId)
        }
    }

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
            if (offline) {
                item(key = "offline-banner") {
                    OfflineBanner(Modifier.padding(top = 32.dp, bottom = StationGap))
                }
            }
            titleRows.forEachIndexed { index, (row, entry) ->
                // The bar shows this title while it is the current one, and while it slides in to
                // take over; drawn twice, the copy in the list would blur behind the bar's. The bar's
                // copy is then the one that flies into the station page.
                val underBar = { (stuckTitle != null && stuck?.index == row) || incoming?.first == row }
                if (entry is HomeEntry.RouteEntry) {
                    item(key = "saved-route-title:${entry.key}", contentType = TITLE_ROW) {
                        RouteTitle(
                            fromName = entry.fromName,
                            toName = entry.toName,
                            onClick = { onRouteClick(entry.fromId, entry.toId) },
                            modifier = Modifier
                                .cardEntrance(index)
                                .graphicsLayer { alpha = if (underBar()) 0f else 1f },
                        )
                    }
                    item(key = "saved-route:${entry.key}") {
                        savedRouteCard.Content(
                            fromId = entry.fromId,
                            toId = entry.toId,
                            modifier = Modifier
                                .cardEntrance(index)
                                .padding(bottom = StationGap),
                        )
                    }
                    return@forEachIndexed
                }
                val card = (entry as HomeEntry.StationEntry).board
                val station = card.station
                if (station is UIState.Success) {
                    item(key = "saved-station-title:${card.stationId}", contentType = TITLE_ROW) {
                        val hidden = underBar()
                        StationTitle(
                            stationId = card.stationId,
                            name = station.data.name,
                            shareName = !hidden,
                            opened = card.stationId == opened,
                            onClick = { openStation(card.stationId) },
                            modifier = Modifier
                                .cardEntrance(index)
                                .graphicsLayer { alpha = if (hidden) 0f else 1f },
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

        // The bar's frost, behind it, the same height throughout: only the names move. With no title
        // at the top yet (the offline banner is above them all) the bar is only the status bar, so
        // neither the frost nor its resting fill covers the banner.
        val barHeight = if (stuck != null) statusBar + with(density) { barTitleHeight.toDp() } else statusBar
        FrostedTopChromeBackdrop(
            hazeState = hazeState,
            chromeHeight = barHeight,
            surfaceColor = MaterialTheme.colorScheme.background,
            scrolled = scrolled,
        )

        StuckTitleBar(
            title = stuckTitle,
            incoming = incoming?.second?.barTitle(),
            pushOffset = { stuck?.pushOffset ?: 0 },
            titleHeight = { barTitleHeight },
            statusBar = statusBar,
            onTitleHeight = { barTitleHeight = it },
            // The bar covers the list's own copy of the title, so it takes the tap for it.
            opened = (stuckTitle as? BarTitle.Station)?.stationId?.let { it == opened } == true,
            onClick = stuckTitle?.let { title -> { openTitle(title) } },
        )
    }
}

/**
 * The bar over the feed: the current entry's title, a station's name or a pair's two, reaching up
 * behind the status bar. It draws
 * no surface of its own; the frost behind it ([FrostedTopChromeBackdrop]) blurs the cards passing
 * under it.
 *
 * The bar holds still and only its names move: when the next station's title pushes in, the
 * current name slides up and fades out over the [NAME_FADE] above it, gone by the status bar, while
 * the next ([incomingName]) slides in beneath it, drawn sharp over the frost where its own row is.
 *
 * Drawn over the list rather than as a sticky header in it: a sticky header pins to the very top of
 * the list, so to clear the clock every title would have to carry the status bar's height, and the
 * stations would sit that much further apart.
 *
 */
@Composable
private fun StuckTitleBar(
    title: BarTitle?,
    incoming: BarTitle?,
    pushOffset: () -> Int,
    titleHeight: () -> Int,
    statusBar: Dp,
    onTitleHeight: (Int) -> Unit,
    opened: Boolean,
    onClick: (() -> Unit)?,
) {
    val density = LocalDensity.current
    val statusBarPx = with(density) { statusBar.roundToPx() }
    val fadePx = with(density) { NAME_FADE.toPx() }

    // The name fades on the feed's entrance curve when the bar gains or loses one, rather than
    // popping: the first time a station loads under the bar, and when the feed empties.
    val nameAlpha by animateFloatAsState(
        targetValue = if (title == null) 0f else 1f,
        animationSpec = tween(NAME_FADE_MILLIS, easing = IosSpringEasing),
        label = "stuckTitleName",
    )
    // The last title shown, kept through the fade out.
    var shownTitle by remember { mutableStateOf(title) }
    if (title != null) {
        shownTitle = title
    }

    Box(modifier = Modifier.fillMaxWidth()) {
        // Always laid out, so the bar's height is known before the first title reaches it.
        BarTitleRow(
            title = shownTitle,
            topInset = statusBar,
            shareName = title is BarTitle.Station,
            opened = opened,
            onClick = onClick,
            modifier = Modifier
                .onSizeChanged { onTitleHeight(it.height - statusBarPx) }
                .graphicsLayer {
                    translationY = pushOffset().toFloat()
                    alpha = nameAlpha
                    // Its own layer, for the mask below to cut alpha from.
                    compositingStrategy = CompositingStrategy.Offscreen
                }
                .drawWithContent {
                    drawContent()
                    // Gone by the status bar, fading in over the band above the name's resting
                    // place. The band holds still on screen while the name rises through it, so in
                    // the name's own coordinates it moves down by however far it has been pushed.
                    val clearAt = statusBarPx - pushOffset().toFloat()
                    drawRect(
                        brush = Brush.verticalGradient(
                            0f to Color.Transparent,
                            1f to Color.Black,
                            startY = clearAt,
                            endY = clearAt + fadePx,
                        ),
                        blendMode = BlendMode.DstIn,
                    )
                },
        )
        if (incoming != null) {
            // Where its row in the list is: one title down, less however far it has pushed.
            BarTitleRow(
                title = incoming,
                topInset = statusBar,
                shareName = false,
                modifier = Modifier.graphicsLayer { translationY = (titleHeight() + pushOffset()).toFloat() },
            )
        }
    }
}

/**
 * A title in the bar, set as the feed sets it. Only a station's name flies into its page; with no
 * title yet, an empty station title still lays out, so the bar has a height to measure.
 */
@Composable
private fun BarTitleRow(
    title: BarTitle?,
    topInset: Dp,
    shareName: Boolean,
    modifier: Modifier = Modifier,
    opened: Boolean = false,
    onClick: (() -> Unit)? = null,
) {
    when (title) {
        is BarTitle.Pair -> RouteTitle(
            fromName = title.fromName,
            toName = title.toName,
            modifier = modifier,
            topInset = topInset,
            onClick = onClick,
        )

        is BarTitle.Station -> StationTitle(
            stationId = title.stationId,
            name = title.name,
            modifier = modifier,
            topInset = topInset,
            shareName = shareName,
            opened = opened,
            onClick = onClick,
        )

        null -> StationTitle(stationId = "", name = "", modifier = modifier, topInset = topInset, shareName = false)
    }
}

/**
 * The band the outgoing name fades out over, above where it rests: the title's own top padding, so
 * a name at rest never dims.
 */
private val NAME_FADE = 16.dp

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

/** The bar's name fading in or out, as long as a card's entrance. */
private const val NAME_FADE_MILLIS = 300

/** The web's --ease-ios-spring, the feed's own curve. */
private val IosSpringEasing = CubicBezierEasing(0.36f, 0.66f, 0.04f, 1f)

/** The web's "Kamu sedang offline" caveat over the feed: what shows may be out of date. */
@Composable
private fun OfflineBanner(modifier: Modifier = Modifier) {
    NoticeBanner(
        message = stringResource(R.string.saved_offline_banner),
        modifier = modifier.padding(horizontal = 16.dp),
    )
}

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
            state = UIState.Success(SavedStationsUiState(entries = emptyList(), lines = emptyMap())),
            now = LocalDateTime.of(2026, 10, 1, 8, 0),
            innerPadding = PaddingValues(),
        )
    }
}
