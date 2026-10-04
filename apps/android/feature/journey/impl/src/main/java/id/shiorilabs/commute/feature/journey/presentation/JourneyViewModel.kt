package id.shiorilabs.commute.feature.journey.presentation

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.assisted.Assisted
import dagger.assisted.AssistedFactory
import dagger.assisted.AssistedInject
import dagger.hilt.android.lifecycle.HiltViewModel
import id.shiorilabs.commute.core.datastore.FarePreferencesRepository
import id.shiorilabs.commute.core.datastore.SavedEntry
import id.shiorilabs.commute.core.datastore.SavedRepository
import id.shiorilabs.commute.core.navigation.Route
import id.shiorilabs.commute.core.type.Failure
import id.shiorilabs.commute.feature.journey.data.JourneyRepository
import id.shiorilabs.commute.feature.journey.domain.Departure
import id.shiorilabs.commute.feature.journey.domain.JourneyCriteria
import id.shiorilabs.commute.feature.journey.domain.PairEnd
import id.shiorilabs.commute.feature.journey.domain.PickableStation
import id.shiorilabs.commute.feature.journey.domain.StationPair
import id.shiorilabs.commute.feature.journey.domain.isStaleDeparture
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
 * The OTW search: the pair, the settings and the answer's options, each opening on its own trip page.
 * A port of the web's `use-fare-query.ts`.
 *
 * [seed] is how search was opened: a station's "OTW Ke Sini" brings only a destination, a shared
 * link may bring criteria too, and home's "Mau ke mana?" brings nothing.
 */
@OptIn(ExperimentalCoroutinesApi::class)
@HiltViewModel(assistedFactory = JourneyViewModel.Factory::class)
class JourneyViewModel @AssistedInject constructor(
    @Assisted private val seed: Route.Otw,
    private val journeyRepository: JourneyRepository,
    private val searchRepository: SearchRepository,
    private val lineRepository: LineRepository,
    private val farePreferences: FarePreferencesRepository,
    private val savedRepository: SavedRepository,
    private val clock: Clock,
) : ViewModel() {

    @AssistedFactory
    interface Factory {
        fun create(seed: Route.Otw): JourneyViewModel
    }

    private data class Session(
        val pair: StationPair,
        val picker: PairEnd?,
    )

    // A to-only start is a rider who has just said where they are going, so the origin picker opens
    // straight away, once, as the web's /fare?to= does.
    private val session = MutableStateFlow(
        Session(
            pair = StationPair(seed.fromId, seed.toId),
            picker = if (seed.toId != null && seed.fromId == null) PairEnd.ORIGIN else null,
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

    val state: StateFlow<JourneyUiState> = combine(session, criteria, trip, stations, lines) { session, criteria, trip, stations, lines ->
        val answer = (trip as? TripState.Loaded)?.answer
        JourneyUiState(
            pair = session.pair,
            origin = session.pair.fromId?.let { endpoint(it, stations, answer?.from?.takeIf { stop -> stop.id == it }?.name) },
            destination = session.pair.toId?.let { endpoint(it, stations, answer?.to?.takeIf { stop -> stop.id == it }?.name) },
            criteria = criteria ?: JourneyCriteria(),
            trip = trip,
            picker = session.picker,
            lines = lines,
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), JourneyUiState(pair = session.value.pair, picker = session.value.picker))

    /**
     * Whether the pair on screen is pinned to home: the pin beside share. `null` until both ends are
     * set, and different, as the web's button renders nothing until then. Directional, so after a
     * swap it reads unpinned until the return trip is pinned too.
     */
    val routeSaved: StateFlow<Boolean?> = combine(
        session.map { it.pair }.distinctUntilChanged(),
        savedRepository.entries,
    ) { pair, entries ->
        val fromId = pair.fromId
        val toId = pair.toId
        if (fromId == null || toId == null || fromId == toId) null else SavedEntry.Route(fromId, toId) in entries
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), null)

    /**
     * The pairs that last answered, for search's "Rute terakhir": named from the station index, so
     * none shows before it loads, and a pair whose station has left it is dropped, as on the web.
     */
    val recentRoutes: StateFlow<List<RecentRouteRow>> = combine(
        farePreferences.recentRoutes,
        stations,
        savedRepository.entries,
    ) { routes, stations, entries ->
        if (stations == null) {
            return@combine emptyList()
        }
        routes.mapNotNull { route ->
            val from = resolveStationId(stations, route.fromId) ?: return@mapNotNull null
            val to = resolveStationId(stations, route.toId) ?: return@mapNotNull null
            RecentRouteRow(
                fromId = route.fromId,
                toId = route.toId,
                fromName = from.name,
                toName = to.name,
                saved = SavedEntry.Route(route.fromId, route.toId) in entries,
            )
        }
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

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
                .withLink(seed.paymentMethod, seed.at, seed.modes, seed.walking, now)
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

    /** The pin beside share: pins the pair on screen to home, or unpins it. */
    fun onToggleSaveRoute() {
        val pair = session.value.pair
        val fromId = pair.fromId ?: return
        val toId = pair.toId ?: return
        if (fromId == toId) {
            return
        }
        viewModelScope.launch { savedRepository.toggleRoute(fromId, toId) }
    }

    /** A recent pair, asked for here in place of whatever pair was on screen. */
    fun onOpenRecent(route: RecentRouteRow) {
        session.update { it.copy(pair = StationPair(route.fromId, route.toId), picker = null) }
    }

    /** A recent pair's pin. */
    fun onToggleRecentRoute(route: RecentRouteRow) {
        viewModelScope.launch { savedRepository.toggleRoute(route.fromId, route.toId) }
    }

    /** The "Hapus" beside "Rute terakhir". */
    fun onClearRecentRoutes() {
        viewModelScope.launch { farePreferences.clearRecentRoutes() }
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
                var recorded = false
                // The last answer held for this ask comes first, however old, then a fresh one.
                journeyRepository.observeTrips(fromId, toId, criteria).collect { query ->
                    val answer = query.data
                    if (answer == null) {
                        val failure = query.failure
                        trip.value = when {
                            failure == null -> TripState.Loading
                            failure is Failure.Remote && failure.code == 404 -> TripState.NotFound
                            else -> TripState.Failed
                        }
                        return@collect
                    }
                    trip.value = TripState.Loaded(
                        answer = answer,
                        isRefreshing = query.isFetching,
                        updatedAt = query.updatedAt,
                        isOutdated = query.isOutdated,
                    )
                    // A pair becomes a recent once it has answered, not on every pick, as on the
                    // web: a half-made selection or a failed lookup is not a trip to offer back.
                    if (!recorded && !query.isFetching && query.failure == null) {
                        recorded = true
                        farePreferences.recordRoute(fromId, toId)
                    }
                }
            }
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
