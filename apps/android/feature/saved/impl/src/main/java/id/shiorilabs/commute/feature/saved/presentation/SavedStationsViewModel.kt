package id.shiorilabs.commute.feature.saved.presentation

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import id.shiorilabs.commute.core.datastore.SavedStationsRepository
import id.shiorilabs.commute.core.time.ServiceDayName
import id.shiorilabs.commute.core.time.nextServiceDayOf
import id.shiorilabs.commute.core.time.serviceDayOf
import id.shiorilabs.commute.core.type.UIState
import id.shiorilabs.commute.core.type.toUserMessage
import id.shiorilabs.commute.feature.station.data.LineRepository
import id.shiorilabs.commute.feature.station.data.StationRepository
import id.shiorilabs.commute.feature.station.domain.LineInfo
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.time.Clock
import java.time.LocalDateTime
import javax.inject.Inject

@HiltViewModel
class SavedStationsViewModel @Inject constructor(
    savedStationsRepository: SavedStationsRepository,
    private val stationRepository: StationRepository,
    private val lineRepository: LineRepository,
    private val clock: Clock,
) : ViewModel() {

    private val cards = MutableStateFlow<Map<String, StationCardState>>(emptyMap())
    private val lines = MutableStateFlow<Map<String, LineInfo>>(emptyMap())

    /** The service day the loaded boards belong to. */
    private var loadedDay: ServiceDayName? = null

    private val savedIds = savedStationsRepository.stations

    val state: StateFlow<UIState<SavedStationsUiState>> = combine(savedIds, cards, lines) { ids, cards, lines ->
        UIState.Success(
            SavedStationsUiState(
                cards = ids.map { cards[it] ?: StationCardState.loading(it) },
                lines = lines,
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

        // A newly saved station loads on arrival; one already loaded keeps its card.
        viewModelScope.launch {
            savedIds.collect { ids ->
                ids.filterNot { it in cards.value }.forEach { load(it) }
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

    fun retry(stationId: String) {
        load(stationId)
        if (lines.value.isEmpty()) {
            viewModelScope.launch {
                lineRepository.lines().onRight { lines.value = it }
            }
        }
    }

    private fun now(): LocalDateTime = LocalDateTime.now(clock)

    private fun load(stationId: String, now: LocalDateTime = now()) {
        val day = serviceDayOf(now)
        val nextDay = nextServiceDayOf(now)
        loadedDay = day

        cards.update { it + (stationId to StationCardState.loading(stationId).copy(nextDayDiffers = nextDay != day)) }

        viewModelScope.launch {
            coroutineScope {
                val station = async { stationRepository.station(stationId) }
                val timetable = async { stationRepository.timetable(stationId, day) }
                // Only fetched when tomorrow runs a different board: the rest of the week today's
                // already holds tomorrow's first trains.
                val nextBoard = if (nextDay != day) async { stationRepository.timetable(stationId, nextDay) } else null

                val stationState = station.await().fold(
                    ifLeft = { UIState.Error(it.toUserMessage(), it.cause) },
                    ifRight = { UIState.Success(it) },
                )
                setCard(stationId) { it.copy(station = stationState) }

                val timetableState = timetable.await().fold(
                    ifLeft = { UIState.Error(it.toUserMessage(), it.cause) },
                    ifRight = { UIState.Success(it) },
                )
                setCard(stationId) { it.copy(timetable = timetableState) }

                val next = nextBoard?.await()?.getOrNull()?.associateBy { it.lineKey }
                setCard(stationId) { it.copy(nextDayBoard = next) }
            }
        }
    }

    private fun setCard(stationId: String, change: (StationCardState) -> StationCardState) {
        cards.update { current ->
            val card = current[stationId] ?: return@update current
            current + (stationId to change(card))
        }
    }
}
