package id.shiorilabs.commute.feature.journey.presentation.savedroute

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.assisted.Assisted
import dagger.assisted.AssistedFactory
import dagger.assisted.AssistedInject
import dagger.hilt.android.lifecycle.HiltViewModel
import id.shiorilabs.commute.core.datastore.FarePreferencesRepository
import id.shiorilabs.commute.core.query.toUIState
import id.shiorilabs.commute.core.type.UIState
import id.shiorilabs.commute.feature.journey.data.JourneyRepository
import id.shiorilabs.commute.feature.journey.domain.DEPARTURE_SLOT_MINUTES
import id.shiorilabs.commute.feature.journey.domain.TripAnswer
import id.shiorilabs.commute.feature.station.data.LineRepository
import id.shiorilabs.commute.feature.station.domain.LineInfo
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import java.time.Clock
import java.time.Instant

/** A saved pair's answer, and the line dictionary its roundels and colour read from. */
data class SavedRouteUiState(
    val answer: UIState<TripAnswer> = UIState.Loading,
    /** Keyed `OPERATOR:CODE`. Empty until it loads. */
    val lines: Map<String, LineInfo> = emptyMap(),
)

/**
 * One saved pair's card on home: its trip answer for now.
 *
 * Asked with the rider's stored settings but always for departing now, whatever departure the OTW
 * search has picked: home answers "what leaves now". The answer is asked again each time the
 * departure slot turns over, the grain the API answers at, so the rows roll forward while home sits
 * open; between turnovers the card drops departed rows by the clock alone.
 */
@HiltViewModel(assistedFactory = SavedRouteViewModel.Factory::class)
class SavedRouteViewModel @AssistedInject constructor(
    @Assisted("from") private val fromId: String,
    @Assisted("to") private val toId: String,
    private val journeyRepository: JourneyRepository,
    private val farePreferences: FarePreferencesRepository,
    private val lineRepository: LineRepository,
    private val clock: Clock,
) : ViewModel() {

    @AssistedFactory
    interface Factory {
        fun create(@Assisted("from") fromId: String, @Assisted("to") toId: String): SavedRouteViewModel
    }

    private val mutableState = MutableStateFlow(SavedRouteUiState(lines = lineRepository.cachedLines().orEmpty()))
    val state: StateFlow<SavedRouteUiState> = mutableState.asStateFlow()

    /** The departure slot the answer was asked in. */
    private var loadedSlot: Long? = null
    private var load: Job? = null

    init {
        if (mutableState.value.lines.isEmpty()) {
            viewModelScope.launch {
                lineRepository.lines().onRight { lines -> mutableState.value = mutableState.value.copy(lines = lines) }
            }
        }
        load(clock.instant())
    }

    /** Called as the card's clock ticks, and as it comes back into view: a new slot asks again. */
    fun onClockTick(now: Instant) {
        if (loadedSlot != null && loadedSlot != slotOf(now)) {
            load(now)
        }
    }

    fun retry() {
        load(clock.instant())
    }

    private fun load(now: Instant) {
        loadedSlot = slotOf(now)
        load?.cancel()
        // What this session already holds, on the card's first frame: the stored settings have to
        // have been read to know which answer that is, as they will have on a warm start.
        if (mutableState.value.answer !is UIState.Success) {
            farePreferences.cachedCriteria()
                ?.let { snapshot -> journeyRepository.cachedTrips(fromId, toId, snapshot.criteria.homeRouteCriteria(now)) }
                ?.let { held -> mutableState.value = mutableState.value.copy(answer = UIState.Success(held)) }
        }
        load = viewModelScope.launch {
            val criteria = farePreferences.criteria.first().homeRouteCriteria(now)
            // The cache keeps the rows on screen while a refresh runs, and after one fails; only a
            // first load with nothing held says it failed. Home's pull to refresh lands here too.
            journeyRepository.observeTrips(fromId, toId, criteria).collect { query ->
                mutableState.value = mutableState.value.copy(answer = query.toUIState())
            }
        }
    }

    private fun slotOf(now: Instant): Long = now.epochSecond / (DEPARTURE_SLOT_MINUTES * 60)
}
