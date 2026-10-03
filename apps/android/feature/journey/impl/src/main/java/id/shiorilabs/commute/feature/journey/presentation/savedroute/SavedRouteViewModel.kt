package id.shiorilabs.commute.feature.journey.presentation.savedroute

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.assisted.Assisted
import dagger.assisted.AssistedFactory
import dagger.assisted.AssistedInject
import dagger.hilt.android.lifecycle.HiltViewModel
import id.shiorilabs.commute.core.datastore.FarePreferencesRepository
import id.shiorilabs.commute.core.type.UIState
import id.shiorilabs.commute.feature.journey.data.JourneyRepository
import id.shiorilabs.commute.feature.journey.domain.DEPARTURE_SLOT_MINUTES
import id.shiorilabs.commute.feature.journey.domain.Departure
import id.shiorilabs.commute.feature.journey.domain.TripAnswer
import id.shiorilabs.commute.feature.journey.domain.toCriteria
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
        // A refresh keeps the rows on screen until the new ones land.
        val previous = mutableState.value.answer
        mutableState.value = mutableState.value.copy(
            answer = if (previous is UIState.Success) previous.copy(isRefreshing = true) else UIState.Loading,
        )
        load = viewModelScope.launch {
            val criteria = farePreferences.criteria.first().toCriteria(now).copy(departure = Departure.Now)
            val answer = journeyRepository.trips(fromId, toId, criteria).fold(
                ifLeft = { failure ->
                    // A failed refresh keeps the rows it had; only a first load says it failed.
                    if (previous is UIState.Success) previous else UIState.Error(message = failure.message, cause = failure.cause)
                },
                ifRight = { UIState.Success(it) },
            )
            mutableState.value = mutableState.value.copy(answer = answer)
        }
    }

    private fun slotOf(now: Instant): Long = now.epochSecond / (DEPARTURE_SLOT_MINUTES * 60)
}
