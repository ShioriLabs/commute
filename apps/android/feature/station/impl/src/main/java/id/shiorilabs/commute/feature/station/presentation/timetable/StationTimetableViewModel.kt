package id.shiorilabs.commute.feature.station.presentation.timetable

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.assisted.Assisted
import dagger.assisted.AssistedFactory
import dagger.assisted.AssistedInject
import dagger.hilt.android.lifecycle.HiltViewModel
import id.shiorilabs.commute.core.query.Query
import id.shiorilabs.commute.core.query.toUIState
import id.shiorilabs.commute.core.time.serviceDayOf
import id.shiorilabs.commute.core.type.UIState
import id.shiorilabs.commute.feature.station.data.LineRepository
import id.shiorilabs.commute.feature.station.data.StationRepository
import id.shiorilabs.commute.feature.station.domain.LineInfo
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.time.Clock
import java.time.Instant
import java.time.LocalDateTime

/** The full timetable page. */
data class StationTimetableUiState(
    /** The station's name, once known. */
    val title: String?,
    /** Every section of the day's board, before the filter. */
    val sections: UIState<List<TimetableSection>>,
    /** Keyed `OPERATOR:CODE`. Empty until it loads; roundels render grey until then. */
    val lines: Map<String, LineInfo>,
    /** The station's lines in board order, for the filter. */
    val lineKeys: List<String>,
    /** Lines the rider filtered out. */
    val excluded: Set<String>,
    /** When the board shown was last confirmed, for the age line under the offline notice. */
    val updatedAt: Instant? = null,
    /** The board shown couldn't be refreshed when it was due. */
    val isOutdated: Boolean = false,
) {

    /** The sections left once [excluded] lines are filtered out. */
    val visibleSections: List<TimetableSection>
        get() = (sections as? UIState.Success)?.data.orEmpty().filter { it.lineKey !in excluded }
}

/**
 * The full timetable for a station: the board for the service day running now, the same one the
 * station page shows. The web lets the API pick the calendar day here, which after midnight is
 * already tomorrow's board while tonight's last trains still run off today's.
 *
 * Observed through the cache like the station page's board: what is held shows at once, offline
 * too, and is refreshed when it is due, with its age for the offline notice.
 */
@HiltViewModel(assistedFactory = StationTimetableViewModel.Factory::class)
class StationTimetableViewModel @AssistedInject constructor(
    @Assisted private val stationId: String,
    private val stationRepository: StationRepository,
    private val lineRepository: LineRepository,
    private val clock: Clock,
) : ViewModel() {

    @AssistedFactory
    interface Factory {
        fun create(stationId: String): StationTimetableViewModel
    }

    private val title = MutableStateFlow(stationRepository.cachedStation(stationId)?.name)
    private val sections = MutableStateFlow(
        stationRepository.cachedTimetable(stationId, serviceDayOf(now()))
            ?.let { Query(timetableSections(it)) }
            ?: Query(isFetching = true),
    )
    private val lines = MutableStateFlow(lineRepository.cachedLines().orEmpty())
    private val excluded = MutableStateFlow<Set<String>>(emptySet())
    private var load: Job? = null

    val state: StateFlow<StationTimetableUiState> = combine(title, sections, lines, excluded, ::uiState).stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(5000),
        initialValue = uiState(title.value, sections.value, lines.value, excluded.value),
    )

    init {
        if (title.value == null) {
            viewModelScope.launch {
                stationRepository.station(stationId).onRight { title.value = it.name }
            }
        }
        if (lines.value.isEmpty()) {
            loadLines()
        }
        loadTimetable()
    }

    /** The filter: hides [lineKey]'s sections, or shows them again. */
    fun onToggleLine(lineKey: String) {
        excluded.update { if (lineKey in it) it - lineKey else it + lineKey }
    }

    fun retry() {
        loadTimetable()
        if (lines.value.isEmpty()) {
            loadLines()
        }
    }

    private fun now(): LocalDateTime = LocalDateTime.now(clock)

    private fun loadLines() {
        viewModelScope.launch {
            lineRepository.lines().onRight { lines.value = it }
        }
    }

    private fun loadTimetable() {
        // A retry replaces a load still in flight, which would otherwise land after it.
        load?.cancel()
        load = viewModelScope.launch {
            stationRepository.observeTimetable(stationId, serviceDayOf(now()))
                .map { query -> query.map(::timetableSections) }
                .flowOn(Dispatchers.Default)
                .collect { sections.value = it }
        }
    }

    private fun uiState(
        title: String?,
        sections: Query<List<TimetableSection>>,
        lines: Map<String, LineInfo>,
        excluded: Set<String>,
    ): StationTimetableUiState = StationTimetableUiState(
        title = title,
        sections = sections.toUIState(),
        lines = lines,
        lineKeys = sections.data.orEmpty().map { it.lineKey }.distinct(),
        excluded = excluded,
        updatedAt = sections.updatedAt,
        isOutdated = sections.isOutdated,
    )
}
