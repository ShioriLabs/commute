package id.shiorilabs.commute.feature.journey.presentation.trip

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.assisted.Assisted
import dagger.assisted.AssistedFactory
import dagger.assisted.AssistedInject
import dagger.hilt.android.lifecycle.HiltViewModel
import id.shiorilabs.commute.core.datastore.FarePreferencesRepository
import id.shiorilabs.commute.core.datastore.DeveloperPreferencesRepository
import id.shiorilabs.commute.core.datastore.LocationPreferencesRepository
import id.shiorilabs.commute.core.datastore.SavedEntry
import id.shiorilabs.commute.core.datastore.SavedRepository
import id.shiorilabs.commute.core.navigation.Route
import id.shiorilabs.commute.core.type.Failure
import id.shiorilabs.commute.feature.journey.data.JourneyRepository
import id.shiorilabs.commute.feature.journey.domain.JourneyCriteria
import id.shiorilabs.commute.feature.journey.domain.TripStart
import id.shiorilabs.commute.feature.journey.domain.toTripPlan
import id.shiorilabs.commute.feature.journey.domain.tripStartFor
import id.shiorilabs.commute.feature.journey.domain.fareShareUrl
import id.shiorilabs.commute.feature.journey.domain.findJourneyByKey
import id.shiorilabs.commute.feature.journey.domain.toCriteria
import id.shiorilabs.commute.feature.journey.domain.toLinkParams
import id.shiorilabs.commute.feature.journey.domain.withLink
import id.shiorilabs.commute.feature.station.data.LineRepository
import id.shiorilabs.commute.feature.trip.TripController
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.time.Clock

/**
 * The trip page: [route]'s pair asked for again under its criteria, and the journey it names found
 * in the answer by route and boarding. Opened from an OTW option, that answer is the one the tab
 * just showed, held in the query cache, so the page lands straight on it.
 *
 * The criteria are fixed for the visit: the page has no settings of its own, and a changed ask is a
 * different list the journey may not be in.
 */
@HiltViewModel(assistedFactory = TripViewModel.Factory::class)
class TripViewModel @AssistedInject constructor(
    @Assisted private val route: Route.Trip,
    private val journeyRepository: JourneyRepository,
    private val lineRepository: LineRepository,
    private val farePreferences: FarePreferencesRepository,
    private val savedRepository: SavedRepository,
    private val clock: Clock,
    private val tripController: TripController,
    locationPreferences: LocationPreferencesRepository,
    developerPreferences: DeveloperPreferencesRepository,
) : ViewModel() {

    @AssistedFactory
    interface Factory {
        fun create(route: Route.Trip): TripViewModel
    }

    /** `null` until stored settings are read: nothing is fetched under the wrong payment method. */
    private val criteria = MutableStateFlow<JourneyCriteria?>(null)
    private val lines = MutableStateFlow(lineRepository.cachedLines().orEmpty())
    private val trip = MutableStateFlow<TripPageState>(TripPageState.Loading)
    private val retries = MutableStateFlow(0)

    val state: StateFlow<TripUiState> = combine(trip, lines, criteria) { trip, lines, criteria ->
        TripUiState(
            trip = trip,
            lines = lines,
            shareUrl = criteria?.let { fareShareUrl(route.fromId, route.toId, it, route.journeyKey) },
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), TripUiState())

    /**
     * Where "Mulai perjalanan" stands for the loaded journey, `null` until there is one. Looked at
     * again every half minute, so a page left open becomes startable when its train gets close.
     */
    val tripStart: StateFlow<TripStart?> = combine(
        trip,
        tripController.active,
        minuteTicks(),
        developerPreferences.forceTripStart,
    ) { trip, active, now, force ->
        (trip as? TripPageState.Loaded)?.let { tripStartFor(it.journey, route, active?.origin, now, force) }
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), null)

    /**
     * Whether starting a trip asks for location: not when "Posisi akurat saat OTW" is off in
     * Pengaturan → Lokasi, as the trip would run by the clock anyway.
     */
    val tripAsksLocation: StateFlow<Boolean> = locationPreferences.use.map { it.allowsTripFixes }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), true)

    /** Follows the loaded journey from now, in place of any trip already running. */
    fun startTrip() {
        val journey = (trip.value as? TripPageState.Loaded)?.journey ?: return
        tripController.start(journey.toTripPlan(), route)
    }

    private fun minuteTicks() = flow {
        while (true) {
            emit(clock.instant())
            delay(TICK_MILLIS)
        }
    }

    /** Whether the pair is pinned to home: the pin beside share. `null` for a pair of one station. */
    val routeSaved: StateFlow<Boolean?> = savedRepository.entries
        .map { entries -> if (route.fromId == route.toId) null else SavedEntry.Route(route.fromId, route.toId) in entries }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), null)

    init {
        viewModelScope.launch {
            val now = clock.instant()
            criteria.value = farePreferences.criteria.first().toCriteria(now)
                .withLink(route.paymentMethod, route.at, route.modes, route.walking, now)
        }
        if (lines.value.isEmpty()) {
            viewModelScope.launch { lineRepository.lines().onRight { lines.value = it } }
        }
        viewModelScope.launch { fetchTrip() }
    }

    fun onToggleSaveRoute() {
        if (route.fromId == route.toId) {
            return
        }
        viewModelScope.launch { savedRepository.toggleRoute(route.fromId, route.toId) }
    }

    fun retry() {
        retries.update { it + 1 }
    }

    /** Search's OTW tab on the same pair and criteria: where the options are, once this journey is gone. */
    fun optionsRoute(): Route.Otw {
        val params = criteria.value?.toLinkParams()
        return Route.Otw(
            fromId = route.fromId,
            toId = route.toId,
            paymentMethod = params?.paymentMethod ?: route.paymentMethod,
            at = params?.at ?: route.at,
            modes = params?.modes ?: route.modes,
            walking = params?.walking ?: route.walking,
        )
    }

    private suspend fun fetchTrip() {
        combine(criteria.filterNotNull(), retries) { criteria, _ -> criteria }
            .collectLatest { criteria ->
                trip.value = TripPageState.Loading
                // The last answer held for this ask comes first, however old, then a fresh one; the
                // journey is found again in each, by its route and the boarding it was opened on.
                journeyRepository.observeTrips(route.fromId, route.toId, criteria).collect { query ->
                    val answer = query.data
                    if (answer == null) {
                        val failure = query.failure
                        trip.value = when {
                            failure == null -> TripPageState.Loading
                            failure is Failure.Remote && failure.code == 404 -> TripPageState.NotFound
                            else -> TripPageState.Failed
                        }
                        return@collect
                    }
                    val index = findJourneyByKey(answer.journeys, route.journeyKey, route.boardingClock)
                    trip.value = when {
                        index != null -> TripPageState.Loaded(
                            journey = answer.journeys[index],
                            updatedAt = query.updatedAt,
                            isOutdated = query.isOutdated,
                        )
                        // An old answer without it says little: wait for the fresh one to say so.
                        query.isFetching -> TripPageState.Loading
                        else -> TripPageState.Gone
                    }
                }
            }
    }

    private companion object {

        const val TICK_MILLIS = 30_000L
    }
}
