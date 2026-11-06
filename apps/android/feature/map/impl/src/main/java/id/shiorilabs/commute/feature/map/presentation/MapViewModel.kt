package id.shiorilabs.commute.feature.map.presentation

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import id.shiorilabs.commute.core.datastore.DeveloperPreferencesRepository
import id.shiorilabs.commute.core.ext.WhileUiSubscribed
import id.shiorilabs.commute.core.navigation.Route
import id.shiorilabs.commute.core.type.UIState
import id.shiorilabs.commute.feature.hub.data.HubDirectory
import id.shiorilabs.commute.feature.hub.data.HubSummary
import id.shiorilabs.commute.feature.journey.domain.PairEnd
import id.shiorilabs.commute.feature.journey.domain.StationPair
import id.shiorilabs.commute.feature.journey.presentation.MapRouteShown
import id.shiorilabs.commute.feature.map.data.MapRepository
import id.shiorilabs.commute.feature.map.domain.MapData
import id.shiorilabs.commute.feature.map.domain.Rgb
import id.shiorilabs.commute.feature.station.data.LineRepository
import id.shiorilabs.commute.feature.station.data.StationDirectory
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class MapViewModel @Inject constructor(
    val repository: MapRepository,
    /** Where the map was left: under a station's page, or closed earlier. */
    val session: MapSession,
    developerPreferences: DeveloperPreferencesRepository,
    private val hubDirectory: HubDirectory,
    private val stationDirectory: StationDirectory,
    private val lineRepository: LineRepository,
) : ViewModel() {

    private val _state = MutableStateFlow<UIState<MapData>>(UIState.Loading)
    val state: StateFlow<UIState<MapData>> = _state.asStateFlow()

    /** Debug: every tap target drawn over the map. */
    val showHitboxes: StateFlow<Boolean> =
        developerPreferences.mapHitboxes.stateIn(viewModelScope, WhileUiSubscribed, false)

    /** Every hub by the id its tap target carries (`HUB-DKA`), once loaded. */
    private val hubs = MutableStateFlow(hubDirectory.cachedHubs().orEmpty().associateBy { it.id })

    init {
        load()
        if (hubs.value.isEmpty()) {
            viewModelScope.launch { hubDirectory.hubs().onRight { list -> hubs.value = list.associateBy { it.id } } }
        }
        // The line dictionary the rings are tinted from, ahead of the first tap.
        if (lineRepository.cachedLines() == null) {
            viewModelScope.launch { lineRepository.lines() }
        }
    }

    fun retry() {
        _state.value = UIState.Loading
        load()
    }

    private var controller: Pair<MapData, MapController>? = null

    /**
     * The map's controller for [data], made once and kept while the map is on the back stack: a page
     * over the map and back finds it as it was, textures and all.
     */
    fun controller(data: MapData, density: Float): MapController {
        controller?.let { (held, made) -> if (held === data) return made }
        controller?.second?.dispose()
        return MapController(
            data = data,
            repository = repository,
            density = density,
            initialCamera = session.camera,
            initialSnapshot = session.snapshot,
            hubFor = ::hubFor,
            ringColorOf = ::ringColorOf,
            lineColorOf = { key -> lineRepository.cachedLines()?.get(key)?.colorCode },
        ).also { controller = data to it }
    }

    override fun onCleared() {
        controller?.second?.let { made ->
            session.camera = made.camera
            session.snapshot = made.snapshot.value
            made.dispose()
        }
        controller = null
    }

    /** The hub tap target [hubId] names, by its slug, with its busiest line's colour for the ring. */
    fun hubFor(hubId: String): Pair<String, Rgb?>? {
        val hub: HubSummary = hubs.value[hubId] ?: return null
        val color = hub.lineKeys.firstOrNull()?.let { lineRepository.cachedLines()?.get(it) }?.colorCode
        return hub.slug to Rgb.parse(color)
    }

    /** Station [stationId]'s first line's colour, as the web's halo takes it: null if unknown. */
    suspend fun ringColorOf(stationId: String): Rgb? {
        val station = (stationDirectory.cached() ?: stationDirectory.all().getOrNull())?.firstOrNull { it.id == stationId }
        val lineKey = station?.lineKeys?.firstOrNull() ?: return null
        val lines = lineRepository.cachedLines() ?: lineRepository.lines().getOrNull() ?: return null
        return Rgb.parse(lines[lineKey]?.colorCode)
    }

    /** The route over the map, OTW's pair as the map holds it: no end set, none. */
    val route: StateFlow<MapRoute> get() = routes
    private val routes = MutableStateFlow(MapRoute())

    /** Which end the next station tapped on the map fills, or null while a tap opens it as usual. */
    val picking: StateFlow<PairEnd?> get() = pickingEnd
    private val pickingEnd = MutableStateFlow<PairEnd?>(null)

    private var seeded = false

    /**
     * Takes up the pair and journey [link] opened the map on, once per map: whether it carried any,
     * for the route's sheet to open on it.
     */
    fun seed(link: Route.Map): Boolean {
        if (seeded) return false
        seeded = true
        val fromId = link.fromId
        val toId = link.toId
        if (fromId == null && toId == null) return false
        val journey = link.journeyKey?.takeIf { fromId != null && toId != null }?.let { key ->
            Route.Trip(fromId = fromId!!, toId = toId!!, journeyKey = key, boardingClock = link.boardingClock)
        }
        routes.value = MapRoute(StationPair(fromId, toId), journey)
        return true
    }

    /** The pair as the rider set it in the sheet; a changed pair closes the journey it had open. */
    fun setPair(fromId: String?, toId: String?) {
        routes.update { route ->
            val pair = StationPair(fromId, toId)
            if (pair == route.pair) route else route.copy(pair = pair, journey = null)
        }
    }

    fun openJourney(journey: Route.Trip) {
        routes.update { it.copy(journey = journey) }
    }

    fun closeJourney() {
        routes.update { it.copy(journey = null) }
    }

    /**
     * What the sheet says to draw. A journey not loaded yet (its own page opening) keeps the one
     * drawn for the same pair, so the route doesn't blink out between the two pages.
     */
    fun onShown(shown: MapRouteShown) {
        routes.update { route ->
            val held = route.shown
            val keep = shown.journey == null && held?.journey != null && held.fromId == shown.fromId && held.toId == shown.toId
            route.copy(shown = if (keep) shown.copy(journey = held!!.journey) else shown)
        }
    }

    /** "OTW Ke Sini": [stationId] the destination, the origin picked on the map next. */
    fun otwTo(stationId: String) {
        setPair(routes.value.pair.fromId?.takeIf { it != stationId }, stationId)
        pickingEnd.value = PairEnd.ORIGIN
    }

    /** The next station tapped on the map fills [end]. */
    fun arm(end: PairEnd) {
        pickingEnd.value = end
    }

    fun disarm() {
        pickingEnd.value = null
    }

    /**
     * [stationId] tapped while an end is armed: it fills that end, unless it is the station already
     * at the other. Whether it was taken.
     */
    fun pick(stationId: String): Boolean {
        val end = pickingEnd.value ?: return false
        val picked = routes.value.pair.pickedOnMap(end, stationId) ?: return false
        setPair(picked.fromId, picked.toId)
        pickingEnd.value = null
        return true
    }

    fun clearRoute() {
        routes.value = MapRoute()
        pickingEnd.value = null
    }

    private fun load() {
        viewModelScope.launch {
            _state.value = repository.mapData().fold(
                ifLeft = { UIState.Error(cause = it.cause) },
                ifRight = { UIState.Success(it) },
            )
        }
    }
}

/**
 * The route over the map: OTW's [pair], the [journey] open in its sheet (null on the options), and
 * what the sheet last said to draw.
 */
data class MapRoute(
    val pair: StationPair = StationPair(),
    val journey: Route.Trip? = null,
    val shown: MapRouteShown? = null,
) {

    val fromId: String? get() = pair.fromId
    val toId: String? get() = pair.toId

    /** Whether either end is set: a route to draw and fold away to the chip. */
    val isSet: Boolean get() = pair.fromId != null || pair.toId != null
}

/**
 * [this] pair with [end] filled by [stationId] tapped on the map; null for the station already at
 * the other end, which a tap there doesn't take, as on the web's map.
 */
fun StationPair.pickedOnMap(end: PairEnd, stationId: String): StationPair? = when (end) {
    PairEnd.ORIGIN -> StationPair(stationId, toId).takeIf { stationId != toId }
    PairEnd.DESTINATION -> StationPair(fromId, stationId).takeIf { stationId != fromId }
}
