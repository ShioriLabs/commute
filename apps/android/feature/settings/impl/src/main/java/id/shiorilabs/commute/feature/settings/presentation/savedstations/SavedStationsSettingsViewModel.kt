package id.shiorilabs.commute.feature.settings.presentation.savedstations

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import id.shiorilabs.commute.core.datastore.SavedEntry
import id.shiorilabs.commute.core.datastore.SavedRepository
import id.shiorilabs.commute.core.type.UIState
import id.shiorilabs.commute.feature.station.data.StationRepository
import id.shiorilabs.commute.feature.station.domain.Station
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** A row of the page: the station as it loads, and whether it is still pinned. */
data class SavedStationRow(
    val id: String,
    val isSaved: Boolean,
    val station: UIState<Station>,
    val isFirst: Boolean,
    val isLast: Boolean,
)

/**
 * The saved stations page. The list is read once, as the page opens, and edited from there: each
 * pin, unpin and move is stored straight away, but an unpinned station keeps its row until the
 * page is left, so pinning it again puts it back where it was. The web stages the same edits and
 * stores them on leaving; storing as they happen means a process death loses none of them.
 */
@HiltViewModel
class SavedStationsSettingsViewModel @Inject constructor(
    private val savedRepository: SavedRepository,
    private val stationRepository: StationRepository,
) : ViewModel() {

    /** The rows being edited; `null` until the saved list has been read. */
    private val rows = MutableStateFlow<List<EditableStation>?>(null)
    private val stations = MutableStateFlow<Map<String, UIState<Station>>>(emptyMap())

    val state: StateFlow<UIState<List<SavedStationRow>>> = combine(rows.filterNotNull(), stations) { rows, stations ->
        UIState.Success(
            rows.mapIndexedNotNull { index, row ->
                val station = stations[row.id] ?: UIState.Loading
                // A station that didn't load has no name to show; the web drops its row too.
                if (station is UIState.Error) {
                    return@mapIndexedNotNull null
                }
                SavedStationRow(
                    id = row.id,
                    isSaved = row.isSaved,
                    station = station,
                    isFirst = index == 0,
                    isLast = index == rows.lastIndex,
                )
            },
        ) as UIState<List<SavedStationRow>>
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(5000),
        initialValue = UIState.Loading,
    )

    init {
        viewModelScope.launch {
            val ids = savedRepository.stationIds.first()
            rows.value = ids.map { EditableStation(it) }
            ids.forEach(::load)

            // Every edit after that is stored as it happens, one write after another.
            rows.filterNotNull().drop(1).collect { edited ->
                // Pairs aren't on this page yet; they keep their place after the stations.
                val routes = savedRepository.entries.first().filterIsInstance<SavedEntry.Route>()
                savedRepository.replace(edited.committed().map(SavedEntry::Station) + routes)
            }
        }
    }

    fun onToggle(stationId: String) {
        rows.update { it?.toggle(stationId) }
    }

    /** Moves the station one place up ([offset] -1) or down (+1). */
    fun onMove(stationId: String, offset: Int) {
        rows.update { current ->
            val from = current?.indexOfFirst { it.id == stationId } ?: return@update current
            if (from == -1) current else current.move(from, from + offset)
        }
    }

    private fun load(stationId: String) {
        val cached = stationRepository.cachedStation(stationId)
        if (cached != null) {
            stations.update { it + (stationId to UIState.Success(cached)) }
            return
        }
        stations.update { it + (stationId to UIState.Loading) }
        viewModelScope.launch {
            val loaded = stationRepository.station(stationId).fold(
                ifLeft = { UIState.Error() },
                ifRight = { UIState.Success(it) },
            )
            stations.update { it + (stationId to loaded) }
        }
    }
}
