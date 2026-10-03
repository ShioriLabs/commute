package id.shiorilabs.commute.feature.saved.presentation

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import id.shiorilabs.commute.core.datastore.SavedEntry
import id.shiorilabs.commute.core.datastore.SavedRepository
import id.shiorilabs.commute.core.time.ServiceDayName
import id.shiorilabs.commute.core.time.serviceDayOf
import id.shiorilabs.commute.core.type.UIState
import id.shiorilabs.commute.feature.journey.data.JourneyRepository
import id.shiorilabs.commute.feature.station.data.LineRepository
import id.shiorilabs.commute.feature.station.data.StationRepository
import id.shiorilabs.commute.feature.station.data.board
import id.shiorilabs.commute.feature.station.domain.LineInfo
import id.shiorilabs.commute.feature.station.domain.StationBoard
import kotlinx.coroutines.Job
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.time.Clock
import java.time.LocalDateTime
import javax.inject.Inject

@HiltViewModel
class SavedStationsViewModel @Inject constructor(
    savedRepository: SavedRepository,
    private val stationRepository: StationRepository,
    private val lineRepository: LineRepository,
    private val journeyRepository: JourneyRepository,
    private val clock: Clock,
) : ViewModel() {

    private val cards = MutableStateFlow<Map<String, StationBoard>>(emptyMap())

    /** A pull to refresh in flight. */
    private val refreshing = MutableStateFlow(false)
    private val loads = mutableMapOf<String, Job>()
    private val lines = MutableStateFlow<Map<String, LineInfo>>(emptyMap())

    /** The names of the stations at either end of a pinned pair, by id, as they load. */
    private val names = MutableStateFlow<Map<String, String>>(emptyMap())

    /** The service day the loaded boards belong to. */
    private var loadedDay: ServiceDayName? = null

    private val saved = savedRepository.entries

    val state: StateFlow<UIState<SavedStationsUiState>> = combine(
        saved,
        cards,
        names,
        lines,
        refreshing,
    ) { saved, cards, names, lines, refreshing ->
        UIState.Success(
            SavedStationsUiState(
                entries = saved.map { entry ->
                    when (entry) {
                        is SavedEntry.Station -> HomeEntry.StationEntry(cards[entry.stationId] ?: StationBoard.loading(entry.stationId))
                        is SavedEntry.Route -> HomeEntry.RouteEntry(
                            fromId = entry.fromId,
                            toId = entry.toId,
                            fromName = names[entry.fromId],
                            toName = names[entry.toId],
                        )
                    }
                },
                lines = lines,
                isRefreshing = refreshing,
            ),
        ) as UIState<SavedStationsUiState>
    }
        .catch { emit(UIState.Error(cause = it)) }
        .stateIn(
            scope = viewModelScope,
            started = SharingStarted.WhileSubscribed(5000),
            initialValue = UIState.Loading,
        )

    init {
        viewModelScope.launch {
            lineRepository.lines().onRight { lines.value = it }
        }

        // A newly saved station loads on arrival; one already loaded keeps its card. A pair needs
        // only its stations' names for its title: its card asks for its own trips.
        viewModelScope.launch {
            saved.collect { entries ->
                entries.filterIsInstance<SavedEntry.Station>()
                    .map { it.stationId }
                    .filterNot { it in cards.value }
                    .forEach { load(it) }
                entries.filterIsInstance<SavedEntry.Route>()
                    .flatMap { listOf(it.fromId, it.toId) }
                    .filterNot { it in names.value }
                    .distinct()
                    .forEach(::loadName)
            }
        }
    }

    /**
     * Called as the screen's clock ticks. The boards are for one service day: when it turns over
     * (03:00, or midnight into a holiday), every card refetches, as the web does when its board URL
     * changes. Driven by the screen rather than a timer of its own, so nothing polls while the feed
     * isn't on screen.
     */
    fun onClockTick(now: LocalDateTime) {
        val day = serviceDayOf(now)
        if (loadedDay != null && loadedDay != day) {
            cards.value.keys.forEach { load(it, now) }
        }
    }

    /**
     * The feed's pull to refresh: every pinned station and pair asks again, whatever the age of what
     * it holds (usually for a 304), and the spinner holds until they have all answered. What is on
     * screen stays there meanwhile. Offline it ends at once, the caveat already up.
     */
    fun refresh() {
        if (refreshing.value) return
        refreshing.value = true
        viewModelScope.launch {
            try {
                coroutineScope {
                    for (entry in saved.first()) {
                        launch {
                            when (entry) {
                                is SavedEntry.Station -> stationRepository.refresh(entry.stationId)
                                is SavedEntry.Route -> journeyRepository.refresh(entry.fromId, entry.toId)
                            }
                        }
                    }
                }
            } finally {
                refreshing.value = false
            }
        }
    }

    fun retry(stationId: String) {
        load(stationId)
        if (lines.value.isEmpty()) {
            viewModelScope.launch {
                lineRepository.lines().onRight { lines.value = it }
            }
        }
    }

    private fun now(): LocalDateTime = LocalDateTime.now(clock)

    private fun loadName(stationId: String) {
        stationRepository.cachedStation(stationId)?.let { station ->
            names.update { it + (stationId to station.name) }
            return
        }
        viewModelScope.launch {
            stationRepository.station(stationId).onRight { station ->
                names.update { it + (stationId to station.name) }
            }
        }
    }

    private fun load(stationId: String, now: LocalDateTime = now()) {
        loadedDay = serviceDayOf(now)
        // A retry or a day turnover replaces a load still in flight, which would otherwise land
        // after it and put the older board back.
        loads[stationId]?.cancel()
        // In place before the load starts, so the card counts as loaded from this call on.
        cards.update { it + (stationId to StationBoard.loading(stationId)) }
        loads[stationId] = viewModelScope.launch {
            stationRepository.board(stationId, now).collect { board ->
                cards.update { it + (stationId to board) }
            }
        }
    }
}
