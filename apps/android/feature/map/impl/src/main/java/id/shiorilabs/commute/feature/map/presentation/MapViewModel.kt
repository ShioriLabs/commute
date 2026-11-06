package id.shiorilabs.commute.feature.map.presentation

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import id.shiorilabs.commute.core.datastore.DeveloperPreferencesRepository
import id.shiorilabs.commute.core.ext.WhileUiSubscribed
import id.shiorilabs.commute.core.type.UIState
import id.shiorilabs.commute.feature.hub.data.HubDirectory
import id.shiorilabs.commute.feature.hub.data.HubSummary
import id.shiorilabs.commute.feature.journey.data.JourneyRepository
import id.shiorilabs.commute.feature.journey.domain.JourneyCriteria
import id.shiorilabs.commute.feature.map.data.MapRepository
import id.shiorilabs.commute.feature.map.domain.MapData
import id.shiorilabs.commute.feature.map.domain.Rgb
import id.shiorilabs.commute.feature.map.domain.RouteLeg
import id.shiorilabs.commute.feature.station.data.LineRepository
import id.shiorilabs.commute.feature.station.data.StationDirectory
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.mapNotNull
import kotlinx.coroutines.flow.stateIn
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
    private val journeyRepository: JourneyRepository,
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

    /**
     * The legs of the first journey from [fromId] to [toId], as the map draws them, once an answer is
     * held: none for a pair without a journey.
     */
    fun routeLegs(fromId: String, toId: String): Flow<List<RouteLeg>> =
        journeyRepository.observeTrips(fromId, toId, JourneyCriteria())
            .mapNotNull { query -> query.data?.let { answer -> answer.journeys.firstOrNull()?.routeLegs().orEmpty() } }
            .distinctUntilChanged()

    private fun load() {
        viewModelScope.launch {
            _state.value = repository.mapData().fold(
                ifLeft = { UIState.Error(cause = it.cause) },
                ifRight = { UIState.Success(it) },
            )
        }
    }
}
