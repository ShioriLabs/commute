package id.shiorilabs.commute.feature.station.presentation

import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.SubcomposeLayout
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
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
import id.shiorilabs.commute.core.type.Failure
import id.shiorilabs.commute.core.type.UIState
import id.shiorilabs.commute.core.type.toFailure
import id.shiorilabs.commute.core.ui.components.ProblemPanel
import id.shiorilabs.commute.core.ui.components.SkeletonBlock
import id.shiorilabs.commute.core.ui.preview.CommutePreviewScaffold
import id.shiorilabs.commute.core.ui.time.rememberJakartaNow
import id.shiorilabs.commute.feature.station.R
import id.shiorilabs.commute.feature.station.domain.Amenity
import id.shiorilabs.commute.feature.station.domain.LineInfo
import id.shiorilabs.commute.feature.station.domain.Station
import id.shiorilabs.commute.feature.station.domain.StationBoard
import id.shiorilabs.commute.feature.station.presentation.components.AmenityList
import id.shiorilabs.commute.feature.station.presentation.components.BekasiTimurMemorial
import id.shiorilabs.commute.feature.station.presentation.components.NoScheduleNote
import id.shiorilabs.commute.feature.station.presentation.components.OpenInMapsButton
import id.shiorilabs.commute.feature.station.presentation.components.StationHeader
import id.shiorilabs.commute.feature.station.presentation.components.LineCard
import java.time.LocalDateTime

/** The page is white, not the app's tinted background, as on web. */
private val StationBackground = Color.White

/** The header's wash over the blur, the web's `bg-white/50 backdrop-blur`. */
private val HeaderWash = Color(0x80FFFFFF)
private val HeaderBlur = 8.dp

/** Bekasi Timur, which carries the memorial. */
private const val BEKASI_TIMUR_ID = "KCI-BKST"

/** TransJakarta publishes no timetable, so an empty board there is expected. */
private const val OPERATOR_TJ = "TJ"

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
    LaunchedEffect(now) {
        viewModel.onClockTick(now)
    }

    StationContent(
        state = state,
        now = now,
        innerPadding = innerPadding,
        placeholderTitle = placeholderTitle,
        placeholderLineKeys = placeholderLineKeys,
        openedFromSearch = openedFromSearch,
        onToggleSave = viewModel::onToggleSave,
        onClose = { navigator.pop() },
        onRetry = viewModel::retry,
        onOpenMaps = { station -> mapsUrl(station)?.let(uriHandler::openUri) },
    )
}

@Composable
private fun StationContent(
    state: StationUiState,
    now: LocalDateTime,
    innerPadding: PaddingValues,
    placeholderTitle: String? = null,
    placeholderLineKeys: List<String> = emptyList(),
    openedFromSearch: Boolean = false,
    onToggleSave: () -> Unit = {},
    onClose: () -> Unit = {},
    onRetry: () -> Unit = {},
    onOpenMaps: (Station) -> Unit = {},
) {
    val hazeState = rememberHazeState()
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
                placeholderTitle = placeholderTitle,
                placeholderLineKeys = placeholderLineKeys,
                openedFromSearch = openedFromSearch,
                topInset = innerPadding.calculateTopPadding(),
                modifier = Modifier.hazeEffect(
                    hazeState,
                    HazeStyle(
                        backgroundColor = StationBackground,
                        tint = HazeTint(HeaderWash),
                        blurRadius = HeaderBlur,
                        noiseFactor = 0f,
                    ),
                ) {
                    // Blur only what is behind the header, as CSS's backdrop-filter does.
                    expandLayerBounds = false
                },
            )
        }.map { it.measure(loose) }
        val headerHeight = header.maxOfOrNull { it.height } ?: 0

        val list = subcompose(StationSlot.LIST) {
            StationList(
                state = state,
                now = now,
                hazeState = hazeState,
                contentPadding = PaddingValues(
                    top = headerHeight.toDp() + 16.dp,
                    bottom = innerPadding.calculateBottomPadding() + 32.dp,
                ),
                onRetry = onRetry,
                onOpenMaps = onOpenMaps,
            )
        }.map { it.measure(constraints) }

        layout(constraints.maxWidth, constraints.maxHeight) {
            list.forEach { it.placeRelative(0, 0) }
            header.forEach { it.placeRelative(0, 0) }
        }
    }
}

private enum class StationSlot { HEADER, LIST }

/** Everything under the header: the departures, then the station's facilities and location. */
@Composable
private fun StationList(
    state: StationUiState,
    now: LocalDateTime,
    hazeState: HazeState,
    contentPadding: PaddingValues,
    onRetry: () -> Unit,
    onOpenMaps: (Station) -> Unit,
) {
    val board = state.board
    val station = (board.station as? UIState.Success)?.data

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .hazeSource(hazeState),
        contentPadding = contentPadding,
    ) {
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

        item(key = "departures") {
            Departures(
                board = board,
                lines = state.lines,
                now = now,
                onRetry = onRetry,
                modifier = Modifier.padding(horizontal = 16.dp),
            )
        }

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
    }
}

/**
 * The line cards, or what stands in for them: a skeleton while the board loads, a retry when it
 * failed, and for an empty board either TransJakarta's no-schedule note or a retry.
 */
@Composable
private fun Departures(
    board: StationBoard,
    lines: Map<String, LineInfo>,
    now: LocalDateTime,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    when (val timetable = board.timetable) {
        // The web's single h-72 block: the page shows every line, so a per-line skeleton would
        // run screens long at an interchange.
        is UIState.Idle, is UIState.Loading -> SkeletonBlock(
            modifier = modifier
                .fillMaxWidth()
                .height(288.dp),
        )

        is UIState.Error -> ProblemPanel(
            message = stringResource(
                if (timetable.isOffline()) R.string.station_timetable_offline else R.string.station_timetable_failed,
            ),
            retryLabel = stringResource(R.string.station_retry),
            onRetry = onRetry,
            modifier = modifier,
        )

        is UIState.Success -> when {
            timetable.data.isNotEmpty() -> Column(
                modifier = modifier,
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                timetable.data.forEach { line ->
                    LineCard(
                        line = line,
                        lineInfo = lines[line.lineKey],
                        now = now,
                        nextDayLine = board.nextDayLine(line),
                        // Lands here from the same card on the home feed.
                        modifier = Modifier.sharedLineCard(board.stationId, line.lineKey, joinAfterFirstFrame = true),
                    )
                }
            }

            board.stationId.substringBefore('-') == OPERATOR_TJ -> NoScheduleNote(modifier)

            else -> ProblemPanel(
                message = stringResource(R.string.station_timetable_empty),
                retryLabel = stringResource(R.string.station_retry),
                onRetry = onRetry,
                modifier = modifier,
            )
        }
    }
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
