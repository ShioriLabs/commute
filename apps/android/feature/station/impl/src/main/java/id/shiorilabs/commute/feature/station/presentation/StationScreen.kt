package id.shiorilabs.commute.feature.station.presentation

import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.SubcomposeLayout
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.chrisbanes.haze.HazeState
import dev.chrisbanes.haze.hazeSource
import dev.chrisbanes.haze.rememberHazeState
import id.shiorilabs.commute.core.navigation.LocalNavigator
import id.shiorilabs.commute.core.navigation.Route
import id.shiorilabs.commute.core.type.Failure
import id.shiorilabs.commute.core.type.UIState
import id.shiorilabs.commute.core.type.toFailure
import id.shiorilabs.commute.core.ui.components.CommuteEmptyState
import id.shiorilabs.commute.core.ui.components.NoticeBanner
import id.shiorilabs.commute.core.ui.components.ProblemPanel
import id.shiorilabs.commute.core.ui.components.SkeletonBlock
import id.shiorilabs.commute.core.ui.ext.RevealInsertedTop
import id.shiorilabs.commute.core.ui.frost.FrostedTopChromeBackdrop
import id.shiorilabs.commute.core.ui.network.rememberIsOffline
import id.shiorilabs.commute.core.ui.preview.CommutePreviewScaffold
import id.shiorilabs.commute.core.ui.time.rememberJakartaNow
import id.shiorilabs.commute.core.ui.time.updatedAgoText
import id.shiorilabs.commute.feature.station.R
import id.shiorilabs.commute.feature.station.domain.Amenity
import id.shiorilabs.commute.feature.station.domain.LineInfo
import id.shiorilabs.commute.feature.station.domain.LineTimetable
import id.shiorilabs.commute.feature.station.domain.Station
import id.shiorilabs.commute.feature.station.domain.StationBoard
import id.shiorilabs.commute.feature.station.domain.isTransJakarta
import id.shiorilabs.commute.feature.station.domain.lastTrains
import id.shiorilabs.commute.feature.station.presentation.components.AmenityList
import id.shiorilabs.commute.feature.station.presentation.components.BekasiTimurMemorial
import id.shiorilabs.commute.feature.station.presentation.components.HalteFrequencies
import id.shiorilabs.commute.feature.station.presentation.components.LastTrainCard
import id.shiorilabs.commute.feature.station.presentation.components.LastTrainsHeading
import id.shiorilabs.commute.feature.station.presentation.components.LineCard
import id.shiorilabs.commute.feature.station.presentation.components.OpenInMapsButton
import id.shiorilabs.commute.feature.station.presentation.components.StationActions
import id.shiorilabs.commute.feature.station.presentation.components.StationHeader
import id.shiorilabs.commute.feature.station.presentation.components.TransferRow
import id.shiorilabs.commute.feature.station.presentation.components.TransfersHeading
import java.time.LocalDateTime
import id.shiorilabs.commute.core.ui.R as CoreUiR

/** The page is white, not the app's tinted background, as on web. */
private val StationBackground = Color.White


/** Bekasi Timur, which carries the memorial. */
private const val BEKASI_TIMUR_ID = "KCI-BKST"

@Composable
fun StationScreen(
    stationId: String,
    innerPadding: PaddingValues,
    placeholderTitle: String? = null,
    placeholderLineKeys: List<String> = emptyList(),
    viewModel: StationViewModel = hiltViewModel<StationViewModel, StationViewModel.Factory>(
        creationCallback = { factory -> factory.create(stationId) },
    ),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val navigator = LocalNavigator.current
    val uriHandler = LocalUriHandler.current
    // Whether search opened this page, whose rows carry roundels to fly in. Read once, while the
    // page is still in the stack: on the way back it has already been popped, and its roundels
    // have to fly home all the same.
    val openedFromSearch = rememberSaveable {
        val stack = navigator.backStack
        stack.getOrNull(stack.indexOfLast { it is Route.Station && it.stationId == stationId } - 1) == Route.Search
    }
    val now = rememberJakartaNow()
    val offline by rememberIsOffline()
    LaunchedEffect(now) {
        viewModel.onClockTick(now)
    }

    StationContent(
        state = state,
        now = now,
        offline = offline,
        innerPadding = innerPadding,
        placeholderTitle = placeholderTitle,
        placeholderLineKeys = placeholderLineKeys,
        openedFromSearch = openedFromSearch,
        onToggleSave = viewModel::onToggleSave,
        onClose = { navigator.pop() },
        onRetry = viewModel::retry,
        onOpenMaps = { station -> mapsUrl(station)?.let(uriHandler::openUri) },
        // Plans a trip here: OTW opens with this station as the destination, picking the origin.
        onOtw = { navigator.goTo(Route.Journey(toId = stationId)) },
        onOpenTimetable = { title -> navigator.goTo(Route.StationTimetable(stationId, title)) },
        onOpenStation = { id -> navigator.goTo(Route.Station(id)) },
    )
}

@Composable
private fun StationContent(
    state: StationUiState,
    now: LocalDateTime,
    innerPadding: PaddingValues,
    offline: Boolean = false,
    placeholderTitle: String? = null,
    placeholderLineKeys: List<String> = emptyList(),
    openedFromSearch: Boolean = false,
    onToggleSave: () -> Unit = {},
    onClose: () -> Unit = {},
    onRetry: () -> Unit = {},
    onOpenMaps: (Station) -> Unit = {},
    onOtw: () -> Unit = {},
    onOpenTimetable: (title: String?) -> Unit = {},
    onOpenStation: (stationId: String) -> Unit = {},
) {
    val hazeState = rememberHazeState()
    val listState = rememberLazyListState()
    // Off its rest position, the page has something under the header for the frost to blur.
    val scrolled by remember {
        derivedStateOf { listState.firstVisibleItemIndex > 0 || listState.firstVisibleItemScrollOffset > 0 }
    }
    val unservedName = state.unserved?.let { stringResource(it.name) }
    val board = state.board
    val station = (board.station as? UIState.Success)?.data

    // The header floats over the page so it can blur what scrolls by, and the list starts under it.
    // Measured together, header first, so the list knows where to start in the very same frame:
    // read back from the header's size afterwards, it started out at the top for one frame, and
    // the line cards flying in from the home feed set off towards there before turning down to
    // their real place, running ahead of the title.
    SubcomposeLayout(
        modifier = Modifier
            .fillMaxSize()
            .background(StationBackground),
    ) { constraints ->
        val loose = constraints.copy(minWidth = 0, minHeight = 0)
        val header = subcompose(StationSlot.HEADER) {
            StationHeader(
                stationId = board.stationId,
                station = board.station,
                lines = state.lines,
                saved = state.saved,
                onToggleSave = onToggleSave,
                onClose = onClose,
                placeholderTitle = unservedName ?: placeholderTitle,
                placeholderLineKeys = if (unservedName != null) emptyList() else placeholderLineKeys,
                openedFromSearch = openedFromSearch,
                topInset = innerPadding.calculateTopPadding(),
                saveable = unservedName == null,
            )
        }.map { it.measure(loose) }
        val headerHeight = header.maxOfOrNull { it.height } ?: 0

        // Behind the header, which draws no surface of its own, and running a little past it.
        val backdrop = subcompose(StationSlot.BACKDROP) {
            FrostedTopChromeBackdrop(
                hazeState = hazeState,
                chromeHeight = headerHeight.toDp(),
                surfaceColor = StationBackground,
                scrolled = scrolled,
            )
        }.map { it.measure(loose) }

        val list = subcompose(StationSlot.LIST) {
            StationList(
                state = state,
                now = now,
                offline = offline,
                listState = listState,
                hazeState = hazeState,
                contentPadding = PaddingValues(
                    top = headerHeight.toDp() + 16.dp,
                    bottom = innerPadding.calculateBottomPadding() + 32.dp,
                ),
                onRetry = onRetry,
                onOpenMaps = onOpenMaps,
                onOtw = onOtw,
                onOpenTimetable = { onOpenTimetable(station?.name ?: placeholderTitle) },
                onOpenStation = onOpenStation,
            )
        }.map { it.measure(constraints) }

        layout(constraints.maxWidth, constraints.maxHeight) {
            list.forEach { it.placeRelative(0, 0) }
            backdrop.forEach { it.placeRelative(0, 0) }
            header.forEach { it.placeRelative(0, 0) }
        }
    }
}

private enum class StationSlot { HEADER, BACKDROP, LIST }

/**
 * Everything under the header: the actions and departures with the last trains, then the station's
 * facilities, location and transfers.
 */
@Composable
private fun StationList(
    state: StationUiState,
    now: LocalDateTime,
    offline: Boolean,
    listState: LazyListState,
    hazeState: HazeState,
    contentPadding: PaddingValues,
    onRetry: () -> Unit,
    onOpenMaps: (Station) -> Unit,
    onOtw: () -> Unit,
    onOpenTimetable: () -> Unit,
    onOpenStation: (stationId: String) -> Unit,
) {
    val board = state.board
    val station = (board.station as? UIState.Success)?.data
    val timetableShown = (board.timetable as? UIState.Success)?.data?.isNotEmpty() == true
    listState.RevealInsertedTop(offline && timetableShown)

    LazyColumn(
        state = listState,
        modifier = Modifier
            .fillMaxSize()
            .hazeSource(hazeState),
        contentPadding = contentPadding,
    ) {
        state.unserved?.let { unserved ->
            // Nothing was fetched: the notice is the page.
            item(key = "unserved") {
                UnservedNotice(unserved, Modifier.padding(horizontal = 16.dp))
            }
            return@LazyColumn
        }

        // Above everything, as on the web: it reframes the whole page. The name, lines and
        // facilities below are still true of the building, but no train calls here.
        state.retired?.let { retired ->
            item(key = "retired") {
                NoticeBanner(
                    message = stringResource(retired.message),
                    linkLabel = retired.redirect?.let { stringResource(it.label) },
                    onLinkClick = { retired.redirect?.let { onOpenStation(it.stationId) } },
                    modifier = Modifier
                        .padding(horizontal = 16.dp)
                        .padding(bottom = 16.dp),
                )
            }
        }

        val stationState = board.station
        if (stationState is UIState.Error) {
            // Nothing below can be drawn without the station, so one panel stands for it all.
            item(key = "station-failed") {
                ProblemPanel(
                    message = stringResource(
                        if (stationState.isOffline()) R.string.station_offline else R.string.station_failed,
                    ),
                    retryLabel = stringResource(R.string.station_retry),
                    onRetry = onRetry,
                    modifier = Modifier.padding(horizontal = 16.dp),
                )
            }
            return@LazyColumn
        }

        departures(
            board = board,
            lines = state.lines,
            now = now,
            offline = offline,
            onRetry = onRetry,
            onOtw = onOtw,
            onOpenTimetable = onOpenTimetable,
        )

        if (station == null) {
            return@LazyColumn
        }

        if (station.id.equals(BEKASI_TIMUR_ID, ignoreCase = true)) {
            item(key = "memorial") {
                BekasiTimurMemorial(Modifier.padding(start = 16.dp, top = 32.dp, end = 16.dp))
            }
        }

        item(key = "amenities") {
            AmenityList(
                amenities = station.amenities,
                modifier = Modifier.padding(start = 16.dp, top = 32.dp, end = 16.dp),
            )
        }

        if (station.latitude != null && station.longitude != null) {
            item(key = "maps") {
                OpenInMapsButton(
                    onClick = { onOpenMaps(station) },
                    modifier = Modifier.padding(start = 16.dp, top = 32.dp, end = 16.dp),
                )
            }
        }

        // Outside the departures: a TransJakarta halte with no timetable still has its transfers.
        val transfers = (state.transfers as? UIState.Success)?.data.orEmpty()
        if (transfers.isNotEmpty()) {
            item(key = "transfers-heading") {
                // Inset by the page's gutter like the sections above, then by the section's own.
                TransfersHeading(Modifier.padding(start = 16.dp, top = 32.dp, end = 16.dp))
            }
            itemsIndexed(transfers, key = { _, transfer -> "transfer:${transfer.id}" }) { _, transfer ->
                TransferRow(
                    transfer = transfer,
                    lines = state.lines,
                    modifier = Modifier.padding(start = 16.dp, top = 16.dp, end = 16.dp),
                )
            }
        }
    }
}

/**
 * The line cards, or what stands in for them: a skeleton while the board loads, a retry when it
 * failed, and for an empty board either a halte's frequencies (TransJakarta publishes no timetable)
 * or a retry.
 *
 * A list item per card rather than one item holding them all, so opening the page builds and
 * measures only the cards on screen. One item had the frame a station opens on lay out every card
 * the station has, an interchange's below the fold included, twice over while the shared transition
 * worked out where everything lands.
 */
private fun LazyListScope.departures(
    board: StationBoard,
    lines: Map<String, LineInfo>,
    now: LocalDateTime,
    offline: Boolean,
    onRetry: () -> Unit,
    onOtw: () -> Unit,
    onOpenTimetable: () -> Unit,
) {
    val inset = Modifier.padding(horizontal = 16.dp)
    // The web's single h-72 block: the page shows every line, so a per-line skeleton would run
    // screens long at an interchange.
    val skeleton = {
        item(key = "departures-loading") {
            SkeletonBlock(
                modifier = inset
                    .fillMaxWidth()
                    .height(288.dp),
            )
        }
    }
    when (val timetable = board.timetable) {
        is UIState.Idle, is UIState.Loading -> skeleton()

        is UIState.Error -> item(key = "departures-failed") {
            ProblemPanel(
                message = stringResource(
                    if (timetable.isOffline()) R.string.station_timetable_offline else R.string.station_timetable_failed,
                ),
                retryLabel = stringResource(R.string.station_retry),
                onRetry = onRetry,
                modifier = inset,
            )
        }

        is UIState.Success -> when {
            timetable.data.isNotEmpty() -> {
                // Over a board that may have been loaded before the connection went, as on the web,
                // or one that couldn't be refreshed when it was due: either way, how old it is.
                if (offline || board.isOutdated) {
                    item(key = "offline-banner") {
                        NoticeBanner(
                            message = stringResource(
                                if (offline) R.string.station_offline_banner else R.string.station_outdated_banner,
                            ),
                            detail = board.updatedAt?.let { updatedAgoText(it) },
                            modifier = inset.padding(bottom = 16.dp),
                        )
                    }
                }
                item(key = "actions") {
                    StationActions(
                        onOtw = onOtw,
                        onOpenTimetable = onOpenTimetable,
                        modifier = inset.padding(bottom = 16.dp),
                    )
                }
                itemsIndexed(timetable.data, key = { _, line -> "line:${line.lineKey}" }) { index, line ->
                    LineCard(
                        line = line,
                        lineInfo = lines[line.lineKey],
                        now = now,
                        nextDayLine = board.nextDayLine(line),
                        // Lands here from the same card on the home feed.
                        modifier = inset
                            .padding(top = if (index == 0) 0.dp else 16.dp)
                            .sharedLineCard(board.stationId, line.lineKey, joinAfterFirstFrame = true),
                    )
                }
                lastTrains(timetable.data, lines)
            }

            // A missing schedule is a fact about the operator, so trip planning stays on offer. The
            // skeleton holds while the frequencies load alongside the board, rather than flashing
            // the no-schedule note before they replace it.
            isTransJakarta(board.stationId) -> when (val frequencies = board.frequencies) {
                is UIState.Idle, is UIState.Loading -> skeleton()
                is UIState.Success, is UIState.Error -> {
                    item(key = "departures-frequencies") {
                        HalteFrequencies(
                            frequencies = (frequencies as? UIState.Success)?.data,
                            lines = lines,
                            modifier = inset,
                        )
                    }
                    item(key = "actions") {
                        StationActions(onOtw = onOtw, modifier = inset.padding(top = 16.dp))
                    }
                }
            }

            else -> item(key = "departures-empty") {
                ProblemPanel(
                    message = stringResource(R.string.station_timetable_empty),
                    retryLabel = stringResource(R.string.station_retry),
                    onRetry = onRetry,
                    modifier = inset,
                )
            }
        }
    }
}

/** The "Kereta terakhir" cards, one item each, under a heading of their own. */
private fun LazyListScope.lastTrains(timetable: List<LineTimetable>, lines: Map<String, LineInfo>) {
    val lastTrainLines = lastTrains(timetable)
    if (lastTrainLines.isEmpty()) {
        return
    }
    item(key = "last-trains-heading") {
        LastTrainsHeading(Modifier.padding(top = 32.dp, bottom = 16.dp))
    }
    itemsIndexed(lastTrainLines, key = { _, line -> "last-train:${line.lineKey}" }) { index, line ->
        LastTrainCard(
            line = line,
            lineInfo = lines[line.lineKey],
            modifier = Modifier
                .padding(horizontal = 16.dp)
                .padding(top = if (index == 0) 0.dp else 16.dp),
        )
    }
}

/** The web's EmptyState in its no-data form, worded for the station. */
@Composable
private fun UnservedNotice(unserved: UnservedStation, modifier: Modifier = Modifier) {
    CommuteEmptyState(
        illustration = painterResource(CoreUiR.drawable.img_search_empty),
        illustrationDescription = stringResource(R.string.station_unserved_illustration_description),
        title = stringResource(unserved.title),
        body = AnnotatedString(stringResource(unserved.message)),
        modifier = modifier
            .fillMaxWidth()
            .padding(top = 16.dp),
    )
}

private fun UIState.Error.isOffline(): Boolean = cause?.toFailure() is Failure.Network

/** The station's pin in Google Maps, labelled with its name, as the web links it. */
private fun mapsUrl(station: Station): String? {
    val latitude = station.latitude ?: return null
    val longitude = station.longitude ?: return null
    return "https://maps.google.com/maps?q=$latitude,$longitude(${Uri.encode(station.name)})"
}

private val previewLines = mapOf("KCI:B" to LineInfo("Lin Bogor", "B", "#EE3D43", "KCI"))

@Preview(showBackground = true)
@Composable
private fun StationContentPreview() {
    CommutePreviewScaffold {
        StationContent(
            state = StationUiState(
                board = StationBoard.loading("KCI-MRI").copy(
                    station = UIState.Success(
                        Station(
                            id = "KCI-MRI",
                            name = "Manggarai",
                            operator = "KCI",
                            code = "MRI",
                            lineKeys = listOf("KCI:B"),
                            amenities = listOf(Amenity("TOILET", null), Amenity("PRAYING_ROOM", null)),
                            latitude = -6.21,
                            longitude = 106.8498,
                        ),
                    ),
                    timetable = UIState.Success(emptyList()),
                ),
                lines = previewLines,
                saved = false,
            ),
            now = LocalDateTime.of(2026, 10, 1, 8, 0),
            innerPadding = PaddingValues(),
        )
    }
}

@Preview(showBackground = true)
@Composable
private fun StationContentLoadingPreview() {
    CommutePreviewScaffold {
        StationContent(
            state = StationUiState(board = StationBoard.loading("KCI-MRI"), lines = emptyMap(), saved = false),
            now = LocalDateTime.of(2026, 10, 1, 8, 0),
            innerPadding = PaddingValues(),
        )
    }
}
