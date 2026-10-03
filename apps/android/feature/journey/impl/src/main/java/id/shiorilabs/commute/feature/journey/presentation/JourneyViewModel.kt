package id.shiorilabs.commute.feature.journey.presentation

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.assisted.Assisted
import dagger.assisted.AssistedFactory
import dagger.assisted.AssistedInject
import dagger.hilt.android.lifecycle.HiltViewModel
import id.shiorilabs.commute.core.datastore.FarePreferencesRepository
import id.shiorilabs.commute.core.navigation.Route
import id.shiorilabs.commute.core.type.Failure
import id.shiorilabs.commute.feature.journey.data.JourneyRepository
import id.shiorilabs.commute.feature.journey.domain.Departure
import id.shiorilabs.commute.feature.journey.domain.JourneyCriteria
import id.shiorilabs.commute.feature.journey.domain.PairEnd
import id.shiorilabs.commute.feature.journey.domain.PickableStation
import id.shiorilabs.commute.feature.journey.domain.StationPair
import id.shiorilabs.commute.feature.journey.domain.TripAnswer
import id.shiorilabs.commute.feature.journey.domain.fareShareUrl
import id.shiorilabs.commute.feature.journey.domain.findJourneyByKey
import id.shiorilabs.commute.feature.journey.domain.isStaleDeparture
import id.shiorilabs.commute.feature.journey.domain.journeyKey
import id.shiorilabs.commute.feature.journey.domain.quickPickStations
import id.shiorilabs.commute.feature.journey.domain.rankStations
import id.shiorilabs.commute.feature.journey.domain.resolveStationId
import id.shiorilabs.commute.feature.journey.domain.toCriteria
import id.shiorilabs.commute.feature.journey.domain.toPickableStations
import id.shiorilabs.commute.feature.journey.domain.toStored
import id.shiorilabs.commute.feature.journey.domain.untilDepartureStale
import id.shiorilabs.commute.feature.journey.domain.withLink
import id.shiorilabs.commute.feature.search.data.SearchRepository
import id.shiorilabs.commute.feature.station.data.LineRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.first

import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.mapLatest
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.Clock

/**
 * The OTW search: the pair, the settings, the answer and which of its pages shows. A port of the
 * web's `use-fare-query.ts` with `journey-pager.ts` folded in.
 *
 * [route] is how it was opened: a station's "OTW Ke Sini" brings only a destination, a shared link
 * may name a journey and criteria, and the search tab brings nothing.
 */
@OptIn(ExperimentalCoroutinesApi::class)
@HiltViewModel(assistedFactory = JourneyViewModel.Factory::class)
class JourneyViewModel @AssistedInject constructor(
    @Assisted private val route: Route.Journey,
    private val journeyRepository: JourneyRepository,
    private val searchRepository: SearchRepository,
    private val lineRepository: LineRepository,
    private val farePreferences: FarePreferencesRepository,
    private val clock: Clock,
) : ViewModel() {

    @AssistedFactory
    interface Factory {
        fun create(route: Route.Journey): JourneyViewModel
    }

    private data class Session(
        val pair: StationPair,
        val picker: PairEnd?,
        val page: JourneyPage = JourneyPage.OPTIONS,
        val selected: Int = 0,
    )

    // A to-only start is a rider who has just said where they are going, so the origin picker opens
    // straight away, once, as the web's /fare?to= does.
    private val session = MutableStateFlow(
        Session(
            pair = StationPair(route.fromId, route.toId),
            picker = if (route.toId != null && route.fromId == null) PairEnd.ORIGIN else null,
        ),
    )

    /** `null` until stored settings are read: nothing is fetched under the wrong payment method. */
    private val criteria = MutableStateFlow<JourneyCriteria?>(null)
    private val stations = MutableStateFlow<List<PickableStation>?>(null)
    private val lines = MutableStateFlow(lineRepository.cachedLines().orEmpty())
    private val trip = MutableStateFlow<TripState>(TripState.Idle)
    private val retries = MutableStateFlow(0)
    private val pickerQuery = MutableStateFlow("")

    /**
     * What the rider has typed into the picker, straight back with no ranking in between. The field
     * must read this rather than [PickerUiState.query]: a value that comes back late resets the
     * keyboard's word in progress, which scrambles typing on composing keyboards (Gboard's 12-key).
     */
    val pickerText: StateFlow<String> = pickerQuery.asStateFlow()

    /** The journey a shared link named, and which boarding of it, honoured on the first answer only. */
    private var sharedKey: String? = route.journeyKey
    private var sharedBoarding: String? = route.boardingClock

    val state: StateFlow<JourneyUiState> = combine(session, criteria, trip, stations, lines) { session, criteria, trip, stations, lines ->
        val answer = (trip as? TripState.Loaded)?.answer
        val effective = criteria ?: JourneyCriteria()
        JourneyUiState(
            pair = session.pair,
            origin = session.pair.fromId?.let { endpoint(it, stations, answer?.from?.takeIf { stop -> stop.id == it }?.name) },
            destination = session.pair.toId?.let { endpoint(it, stations, answer?.to?.takeIf { stop -> stop.id == it }?.name) },
            criteria = effective,
            trip = trip,
            page = session.page,
            selected = session.selected,
            picker = session.picker,
            lines = lines,
            shareUrl = fareShareUrl(
                session.pair.fromId,
                session.pair.toId,
                effective,
                answer?.journeys?.getOrNull(session.selected)?.let(::journeyKey),
            ),
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), JourneyUiState(pair = session.value.pair, picker = session.value.picker))

    val picker: StateFlow<PickerUiState> = combine(
        pickerQuery,
        stations,
        farePreferences.recentStationIds,
    ) { query, stations, recents -> Triple(query, stations, recents) }
        // Ranking runs the fuzzy matcher over every station, so off the main thread, as search's
        // does; mapLatest drops a ranking still running when the next keystroke lands.
        .mapLatest { (query, stations, recents) ->
            withContext(Dispatchers.Default) {
                PickerUiState(
                    query = query,
                    stations = stations?.let { rankStations(it, query) }.orEmpty(),
                    quickPicks = stations?.let { quickPickStations(it, recents) }.orEmpty(),
                    loaded = stations != null,
                )
            }
        }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), PickerUiState())

    init {
        viewModelScope.launch {
            val now = clock.instant()
            criteria.value = farePreferences.criteria.first().toCriteria(now)
                .withLink(route.paymentMethod, route.at, route.modes, route.walking, now)
        }
        loadStations()
        if (lines.value.isEmpty()) {
            viewModelScope.launch { lineRepository.lines().onRight { lines.value = it } }
        }
        viewModelScope.launch { fetchTrips() }
        viewModelScope.launch { followDeparture() }
    }

    fun openPicker(end: PairEnd) {
        pickerQuery.value = ""
        session.update { it.copy(picker = end) }
    }

    fun closePicker() {
        session.update { it.copy(picker = null) }
    }

    fun onPickerQueryChange(query: String) {
        pickerQuery.value = query
    }

    /** Sets the end the picker is open for; picking the other end's station swaps the two. */
    fun onPick(station: PickableStation) {
        val end = session.value.picker ?: return
        session.update { it.copy(pair = it.pair.with(end, station.id), picker = null) }
        viewModelScope.launch { farePreferences.recordStation(station.id) }
    }

    fun onSwap() {
        session.update { it.copy(pair = it.pair.swapped()) }
    }

    fun onCriteriaChange(next: JourneyCriteria) {
        criteria.value = next
        viewModelScope.launch { farePreferences.saveCriteria(next.toStored()) }
    }

    fun onSelectJourney(index: Int) {
        session.update { it.copy(selected = index, page = JourneyPage.DETAIL) }
    }

    fun onBackToOptions() {
        session.update { it.copy(page = JourneyPage.OPTIONS) }
    }

    fun retry() {
        retries.update { it + 1 }
        if (stations.value == null) {
            loadStations()
        }
    }

    /**
     * The screen came back into view: a picked departure the clock overtook while it was away goes
     * back to now, as the web does on `visibilitychange`.
     */
    fun onResume() {
        val current = criteria.value ?: return
        if (isStaleDeparture(current.departure, clock.instant())) {
            onCriteriaChange(current.copy(departure = Departure.Now))
        }
    }

    private fun endpoint(id: String, stations: List<PickableStation>?, answerName: String?): PairEndpoint {
        val station = stations?.let { resolveStationId(it, id) }
        return PairEndpoint(id = id, station = station, name = station?.name ?: answerName)
    }

    private fun loadStations() {
        viewModelScope.launch {
            searchRepository.searchables().onRight { stations.value = toPickableStations(it) }
        }
    }

    private suspend fun fetchTrips() {
        combine(
            session.map { it.pair }.distinctUntilChanged(),
            criteria.filterNotNull(),
            retries,
        ) { pair, criteria, _ -> pair to criteria }
            .collectLatest { (pair, criteria) ->
                val fromId = pair.fromId
                val toId = pair.toId
                if (fromId == null || toId == null || fromId == toId) {
                    trip.value = TripState.Idle
                    return@collectLatest
                }
                trip.value = TripState.Loading
                journeyRepository.trips(fromId, toId, criteria).fold(
                    ifLeft = { failure ->
                        trip.value = if (failure is Failure.Remote && failure.code == 404) TripState.NotFound else TripState.Failed
                    },
                    ifRight = ::onAnswer,
                )
            }
    }

    /**
     * Every new answer lands on its options: the selection is an ordinal into a list recomputed per
     * request, so holding a rider on a detail through a change would swap the journey under them.
     * The one exception is the first answer to a shared link whose route still runs.
     */
    private fun onAnswer(answer: TripAnswer) {
        val shared = findJourneyByKey(answer.journeys, sharedKey, sharedBoarding)
        sharedKey = null
        sharedBoarding = null
        session.update {
            it.copy(
                page = if (shared != null) JourneyPage.DETAIL else JourneyPage.OPTIONS,
                selected = shared ?: 0,
            )
        }
        trip.value = TripState.Loaded(answer)
    }

    /** A picked departure goes back to now once its slot ends, while the screen sits open. */
    private suspend fun followDeparture() {
        criteria.filterNotNull().map { it.departure }.distinctUntilChanged().collectLatest { departure ->
            val wait = untilDepartureStale(departure, clock.instant()) ?: return@collectLatest
            delay(wait.toMillis())
            onResume()
        }
    }
}
