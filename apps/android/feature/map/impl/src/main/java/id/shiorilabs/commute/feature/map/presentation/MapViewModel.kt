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
import id.shiorilabs.commute.core.config.Environment
import id.shiorilabs.commute.feature.map.data.MapRepository
import id.shiorilabs.commute.feature.map.data.MapStorage
import id.shiorilabs.commute.feature.map.domain.BusMap
import id.shiorilabs.commute.feature.map.domain.BusMapFeed
import id.shiorilabs.commute.feature.map.domain.feedGeoJson
import id.shiorilabs.commute.feature.map.domain.BusMapGeoJson
import id.shiorilabs.commute.feature.map.domain.BusMapLineInfo
import id.shiorilabs.commute.feature.map.domain.lineInfo
import id.shiorilabs.commute.feature.map.domain.GeoStop
import id.shiorilabs.commute.feature.map.domain.MapData
import id.shiorilabs.commute.feature.map.domain.stops
import id.shiorilabs.commute.feature.map.domain.toGeoJson
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import id.shiorilabs.commute.feature.map.domain.Rgb
import id.shiorilabs.commute.feature.station.data.LineRepository
import id.shiorilabs.commute.feature.station.data.StationDirectory
import id.shiorilabs.commute.feature.trip.ActiveTrip
import id.shiorilabs.commute.feature.trip.TripController
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
    private val developerPreferences: DeveloperPreferencesRepository,
    private val storage: MapStorage,
    private val environment: Environment,
    private val hubDirectory: HubDirectory,
    private val stationDirectory: StationDirectory,
    private val lineRepository: LineRepository,
    tripController: TripController,
) : ViewModel() {

    /** The trip being followed, drawn on the map with the rider on it while no route is planned. */
    val activeTrip: StateFlow<ActiveTrip?> = tripController.active

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
    }

    fun retry() {
        _state.value = UIState.Loading
        load()
    }

    private var controller: Pair<MapData, MapController>? = null

    /** Home on the map: whether it has opened around the rider yet. Once per map. */
    var homeCentred = false

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
            lineColorOf = { key -> lineRepository.dictionary.value[key]?.colorCode },
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
        val color = hub.lineKeys.firstOrNull()?.let { lineRepository.dictionary.value[it] }?.colorCode
        return hub.slug to Rgb.parse(color)
    }

    /** Station [stationId]'s first line's colour, as the web's halo takes it: null if unknown. */
    suspend fun ringColorOf(stationId: String): Rgb? {
        val station = (stationDirectory.cached() ?: stationDirectory.all().getOrNull())?.firstOrNull { it.id == stationId }
        val lineKey = station?.lineKeys?.firstOrNull() ?: return null
        val lines = lineRepository.dictionary.value.ifEmpty { lineRepository.lines().getOrNull() ?: return null }
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

    /** Experimental "Peta Jalan": the layer picker shows, the streets layer one of its choices. */
    val streetsEnabled: StateFlow<Boolean> =
        developerPreferences.mapStreets.stateIn(viewModelScope, WhileUiSubscribed, false)

    /** The streets layer picked over the FDTJ artwork, as the map was last left. */
    val streetsPicked: StateFlow<Boolean> =
        developerPreferences.mapStreetsShown.stateIn(viewModelScope, WhileUiSubscribed, false)

    /** Experimental "Panel Debug Peta": the streets layer's debug button and its panel. */
    val debugEnabled: StateFlow<Boolean> =
        developerPreferences.mapDebug.stateIn(viewModelScope, WhileUiSubscribed, false)

    /** How the streets layer draws its lines: raw, processed or adjusted. */
    val streetsLines: StateFlow<StreetsLines> get() = session.streetsLines

    fun showLines(lines: StreetsLines) {
        session.streetsLines.value = lines
        if (lines == StreetsLines.RAW) loadFeed()
    }

    /** The lines as the feed has them, as GeoJSON; null until [loadFeed] has read them. */
    val feedLines: StateFlow<String?> get() = feed
    private val feed = MutableStateFlow<String?>(null)
    private var feedLoading = false

    /** Reads the bundled feed shapes once, off the main thread, for Raw: only when it is picked. */
    fun loadFeed() {
        if (feedLoading) return
        feedLoading = true
        viewModelScope.launch {
            val geoJson = runCatching {
                withContext(Dispatchers.Default) {
                    val map = busMapJson.decodeFromString(BusMap.serializer(), storage.bundled(BUS_MAP_FILE))
                    map.feedGeoJson(busMapJson.decodeFromString(BusMapFeed.serializer(), storage.bundled(BUS_MAP_FEED_FILE)))
                }
            }.getOrNull()
            if (geoJson == null) feedLoading = false
            feed.value = geoJson
        }
    }

    fun pickStreets(shown: Boolean) {
        viewModelScope.launch { developerPreferences.setMapStreetsShown(shown) }
    }

    /** shirase's finished style for the streets layer, by the theme. */
    fun streetsStyleUrl(dark: Boolean): String =
        "${environment.shiraseBaseUrl.trimEnd('/')}/styles/${if (dark) "dark" else "light"}.json"

    /** Peta Bus as the streets layer draws it; null until [loadBusMap] has read it. */
    val busMap: StateFlow<BusMapLayer?> get() = busMapLayer
    private val busMapLayer = MutableStateFlow<BusMapLayer?>(null)
    private var busMapLoading = false

    /**
     * Reads the bundled Peta Bus once, off the main thread, its haltes kept to those with a page:
     * some are routing-only stops the station directory leaves out.
     */
    fun loadBusMap() {
        if (busMapLoading) return
        busMapLoading = true
        viewModelScope.launch {
            val layer = runCatching {
                withContext(Dispatchers.Default) {
                    val map = busMapJson.decodeFromString(BusMap.serializer(), storage.bundled(BUS_MAP_FILE))
                    val known = stationDirectory.stored()?.mapTo(HashSet()) { it.id }
                    val tappable: ((String) -> Boolean)? = known?.let { ids -> { id -> id in ids } }
                    BusMapLayer(
                        geoJson = map.toGeoJson(tappable),
                        attribution = map.attribution,
                        stops = map.stops(tappable),
                        lines = map.lineInfo(),
                    )
                }
            }.getOrNull()
            if (layer == null) busMapLoading = false
            busMapLayer.value = layer
        }
    }

    private companion object {
        const val BUS_MAP_FILE = "bus-map.json"
        const val BUS_MAP_FEED_FILE = "bus-map-feed.json"
        val busMapJson = Json { ignoreUnknownKeys = true }
    }
}

/** Peta Bus ready for the streets layer: its sources, whose data it is, and its dots for "Sekitar". */
data class BusMapLayer(
    val geoJson: BusMapGeoJson,
    val attribution: String,
    val stops: List<GeoStop>,
    /** Each line by code: for one picked on the map, its name and how far it reaches. */
    val lines: Map<String, BusMapLineInfo>,
)

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
