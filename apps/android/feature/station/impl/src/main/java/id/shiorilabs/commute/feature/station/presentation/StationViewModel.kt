package id.shiorilabs.commute.feature.station.presentation

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.assisted.Assisted
import dagger.assisted.AssistedFactory
import dagger.assisted.AssistedInject
import dagger.hilt.android.lifecycle.HiltViewModel
import id.shiorilabs.commute.core.datastore.SavedRepository
import id.shiorilabs.commute.core.ext.WhileUiSubscribed
import id.shiorilabs.commute.core.time.ServiceDayName
import id.shiorilabs.commute.core.time.serviceDayOf
import id.shiorilabs.commute.core.type.UIState
import id.shiorilabs.commute.feature.station.data.LineRepository
import id.shiorilabs.commute.feature.station.data.StationRepository
import id.shiorilabs.commute.feature.station.data.board
import id.shiorilabs.commute.feature.station.data.boardHour
import id.shiorilabs.commute.feature.station.data.cachedBoard
import id.shiorilabs.commute.feature.station.data.loadInto
import id.shiorilabs.commute.feature.station.domain.CrowdForecast
import id.shiorilabs.commute.feature.station.domain.StationExit
import id.shiorilabs.commute.feature.station.domain.LineInfo
import id.shiorilabs.commute.feature.station.domain.StationBoard
import id.shiorilabs.commute.feature.station.domain.Transfer
import id.shiorilabs.commute.feature.station.domain.isTransJakarta
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
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
    private val savedRepository: SavedRepository,
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
    /** Null until it loads, and left so when it fails: the badge just isn't shown, as on the web. */
    private val crowding = MutableStateFlow<CrowdForecast?>(null)
    /** Empty until it loads, and left so when it fails or the station has none: the section just isn't shown. */
    private val exits = MutableStateFlow<List<StationExit>>(emptyList())
    private var load: Job? = null

    /** A station no train serves has nothing to load: its notice is the page. */
    private val unserved = unservedStation(stationId)
    private val retired = retiredStation(stationId)

    /** The service day the loaded board belongs to. */
    private var loadedDay: ServiceDayName? = null

    /** The hour the loaded board belongs to, at a halte; null at a rail station (see [boardHour]). */
    private var loadedHour: Int? = null

    val state: StateFlow<StationUiState> = combine(
        board,
        lines,
        savedRepository.stationIds,
        transfers,
        crowding,
    ) { board, lines, saved, transfers, crowding ->
        StationUiState(
            board = board,
            lines = lines,
            saved = stationId in saved,
            transfers = transfers,
            unserved = unserved,
            retired = retired,
            crowding = crowding,
        )
    }.combine(exits) { state, exits ->
        state.copy(exits = exits)
    }.stateIn(
        scope = viewModelScope,
        started = WhileUiSubscribed,
        initialValue = StationUiState(
            board = board.value,
            lines = lines.value,
            saved = false,
            transfers = transfers.value,
            unserved = unserved,
            retired = retired,
        ),
    )

    init {
        if (unserved == null) {
            loadAll()
        }
    }

    /**
     * Called as the screen's clock ticks: when the service day turns over, the board refetches, as
     * the home feed's do. A halte's also does on the hour, since its frequencies are the hour's.
     */
    fun onClockTick(now: LocalDateTime) {
        if (loadedDay != null && (loadedDay != serviceDayOf(now) || loadedHour != boardHour(stationId, now))) {
            load(now)
        }
    }

    fun retry() {
        if (unserved == null) {
            loadAll()
        }
    }

    /** The pin in the header: saves the station to the home screen, or unsaves it. */
    fun onToggleSave() {
        viewModelScope.launch {
            savedRepository.toggleStation(stationId)
        }
    }

    private fun now(): LocalDateTime = LocalDateTime.now(clock)

    /** (Re)loads the board, and the lines, transfers and exits unless they are already in. */
    private fun loadAll() {
        load(now())
        if (lines.value.isEmpty()) {
            loadLines()
        }
        if (transfers.value !is UIState.Success) {
            loadTransfers()
        }
        if (exits.value.isEmpty()) {
            loadExits()
        }
    }

    private fun loadExits() {
        viewModelScope.launch {
            stationRepository.exits(stationId).onRight { exits.value = it }
        }
    }

    private fun loadLines() {
        viewModelScope.launch {
            lineRepository.loadInto(lines)
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
        val day = serviceDayOf(now)
        loadedDay = day
        loadedHour = boardHour(stationId, now)
        // A retry or a day turnover replaces a load still in flight, which would otherwise land
        // after it and put the older board back.
        load?.cancel()
        load = viewModelScope.launch {
            launch {
                stationRepository.board(stationId, now).collect { board.value = it }
            }
            // Rail only, as on the web: the model has no estimate for a halte.
            if (!isTransJakarta(stationId)) {
                launch {
                    stationRepository.observeCrowding(stationId, day).collect { query ->
                        query.data?.let { crowding.value = it }
                    }
                }
            }
        }
    }
}
