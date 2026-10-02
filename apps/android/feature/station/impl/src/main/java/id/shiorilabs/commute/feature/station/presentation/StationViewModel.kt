package id.shiorilabs.commute.feature.station.presentation

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.assisted.Assisted
import dagger.assisted.AssistedFactory
import dagger.assisted.AssistedInject
import dagger.hilt.android.lifecycle.HiltViewModel
import id.shiorilabs.commute.core.datastore.SavedStationsRepository
import id.shiorilabs.commute.core.time.ServiceDayName
import id.shiorilabs.commute.core.time.serviceDayOf
import id.shiorilabs.commute.core.type.UIState
import id.shiorilabs.commute.feature.station.data.LineRepository
import id.shiorilabs.commute.feature.station.data.StationRepository
import id.shiorilabs.commute.feature.station.data.board
import id.shiorilabs.commute.feature.station.data.cachedBoard
import id.shiorilabs.commute.feature.station.domain.LineInfo
import id.shiorilabs.commute.feature.station.domain.StationBoard
import id.shiorilabs.commute.feature.station.domain.Transfer
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import java.time.Clock
import java.time.LocalDateTime

@HiltViewModel(assistedFactory = StationViewModel.Factory::class)
class StationViewModel @AssistedInject constructor(
    @Assisted private val stationId: String,
    private val stationRepository: StationRepository,
    private val lineRepository: LineRepository,
    private val savedStationsRepository: SavedStationsRepository,
    private val clock: Clock,
) : ViewModel() {

    @AssistedFactory
    interface Factory {
        fun create(stationId: String): StationViewModel
    }

    // Seeded from what the home feed already loaded, so a page opened from there arrives whole: its
    // title and cards are there to meet the shared-element transition on its first frame.
    private val board = MutableStateFlow(stationRepository.cachedBoard(stationId, now()) ?: StationBoard.loading(stationId))
    private val lines = MutableStateFlow(lineRepository.cachedLines().orEmpty())
    private val transfers = MutableStateFlow<UIState<List<Transfer>>>(
        stationRepository.cachedTransfers(stationId)?.let { UIState.Success(it) } ?: UIState.Idle,
    )
    private var load: Job? = null

    /** The service day the loaded board belongs to. */
    private var loadedDay: ServiceDayName? = null

    val state: StateFlow<StationUiState> = combine(
        board,
        lines,
        savedStationsRepository.stations,
        transfers,
    ) { board, lines, saved, transfers ->
        StationUiState(board = board, lines = lines, saved = stationId in saved, transfers = transfers)
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(5000),
        initialValue = StationUiState(board = board.value, lines = lines.value, saved = false, transfers = transfers.value),
    )

    init {
        if (lines.value.isEmpty()) {
            loadLines()
        }
        load(now())
        if (transfers.value !is UIState.Success) {
            loadTransfers()
        }
    }

    /**
     * Called as the screen's clock ticks: when the service day turns over, the board refetches, as
     * the home feed's do.
     */
    fun onClockTick(now: LocalDateTime) {
        if (loadedDay != null && loadedDay != serviceDayOf(now)) {
            load(now)
        }
    }

    fun retry() {
        load(now())
        if (lines.value.isEmpty()) {
            loadLines()
        }
        if (transfers.value !is UIState.Success) {
            loadTransfers()
        }
    }

    /** The pin in the header: saves the station to the home screen, or unsaves it. */
    fun onToggleSave() {
        viewModelScope.launch {
            savedStationsRepository.toggle(stationId)
        }
    }

    private fun now(): LocalDateTime = LocalDateTime.now(clock)

    private fun loadLines() {
        viewModelScope.launch {
            lineRepository.lines().onRight { lines.value = it }
        }
    }

    private fun loadTransfers() {
        transfers.value = UIState.Loading
        viewModelScope.launch {
            transfers.value = stationRepository.transfers(stationId).fold(
                ifLeft = { UIState.Error(message = it.message, cause = it.cause) },
                ifRight = { UIState.Success(it) },
            )
        }
    }

    private fun load(now: LocalDateTime) {
        loadedDay = serviceDayOf(now)
        // A retry or a day turnover replaces a load still in flight, which would otherwise land
        // after it and put the older board back.
        load?.cancel()
        load = viewModelScope.launch {
            stationRepository.board(stationId, now).collect { board.value = it }
        }
    }
}
