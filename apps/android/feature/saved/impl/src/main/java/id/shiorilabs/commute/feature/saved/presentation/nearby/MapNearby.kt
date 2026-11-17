package id.shiorilabs.commute.feature.saved.presentation.nearby

import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import id.shiorilabs.commute.core.ext.WhileUiSubscribed
import id.shiorilabs.commute.core.type.UIState
import id.shiorilabs.commute.feature.saved.presentation.components.StationTimetable
import id.shiorilabs.commute.feature.saved.presentation.components.StationTitle
import id.shiorilabs.commute.feature.station.data.StationRepository
import id.shiorilabs.commute.feature.station.data.board
import id.shiorilabs.commute.feature.station.domain.LineInfo
import id.shiorilabs.commute.feature.station.domain.StationBoard
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.stateIn
import java.time.Clock
import java.time.LocalDateTime
import javax.inject.Inject

/**
 * The boards of the stations in view on home's map, once it's panned: what "Sekitar" lists, for
 * home on the map (the Experimental prototype).
 */
@OptIn(ExperimentalCoroutinesApi::class)
@HiltViewModel
class MapNearbyViewModel @Inject constructor(
    private val stationRepository: StationRepository,
    private val clock: Clock,
) : ViewModel() {

    private val shown = MutableStateFlow<List<String>>(emptyList())

    val boards: StateFlow<List<StationBoard>> = shown.flatMapLatest { ids ->
        if (ids.isEmpty()) {
            flowOf(emptyList())
        } else {
            val now = LocalDateTime.now(clock)
            combine(ids.map { stationRepository.board(it, now) }) { it.toList() }
        }
    }.stateIn(viewModelScope, WhileUiSubscribed, emptyList())

    fun show(stationIds: List<String>) {
        shown.value = stationIds
    }
}

/** "Sekitar"'s list: each station in view, its name then its board, as home's nearby section. */
@Composable
internal fun MapNearbyList(
    stationIds: List<String>,
    lines: Map<String, LineInfo>,
    now: LocalDateTime,
    onStationClick: (stationId: String) -> Unit,
    bottomInset: androidx.compose.ui.unit.Dp,
    viewModel: MapNearbyViewModel = hiltViewModel(),
) {
    LaunchedEffect(stationIds) { viewModel.show(stationIds) }
    val boards by viewModel.boards.collectAsStateWithLifecycle()
    // Back to the top for each new set of stations, so the one nearest the middle of the map is the
    // one in view: the list keeps its place by key otherwise, and would stay down among the last set.
    val listState = rememberLazyListState()
    val shownIds = boards.map { it.stationId }
    LaunchedEffect(shownIds) { listState.scrollToItem(0) }
    LazyColumn(
        state = listState,
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(bottom = bottomInset + 16.dp),
    ) {
        boards.forEach { board ->
            val station = (board.station as? UIState.Success)?.data ?: return@forEach
            item(key = "title:${station.id}") {
                StationTitle(
                    stationId = station.id,
                    name = station.name,
                    shareName = false,
                    onClick = { onStationClick(station.id) },
                )
            }
            item(key = "board:${station.id}") {
                StationTimetable(
                    card = board,
                    lineCount = station.lineKeys.size,
                    lines = lines,
                    now = now,
                    onRetry = {},
                    modifier = Modifier.padding(bottom = 24.dp),
                )
            }
        }
    }
}
