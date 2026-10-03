package id.shiorilabs.commute.feature.settings.presentation.savedstations

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import id.shiorilabs.commute.core.datastore.SavedEntry
import id.shiorilabs.commute.core.datastore.SavedRepository
import id.shiorilabs.commute.core.type.UIState
import id.shiorilabs.commute.feature.station.data.StationRepository
import id.shiorilabs.commute.feature.station.domain.Station
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
import javax.inject.Inject

/** A row of the page: a pinned station or pair as it loads, and whether it is still pinned. */
sealed interface SavedRow {

    /** The entry's [SavedEntry.key]. */
    val key: String
    val isSaved: Boolean
    val isFirst: Boolean
    val isLast: Boolean

    data class StationRow(
        override val key: String,
        override val isSaved: Boolean,
        val station: UIState<Station>,
        override val isFirst: Boolean,
        override val isLast: Boolean,
    ) : SavedRow

    data class RouteRow(
        override val key: String,
        override val isSaved: Boolean,
        val fromId: String,
        val toId: String,
        val from: UIState<Station>,
        val to: UIState<Station>,
        override val isFirst: Boolean,
        override val isLast: Boolean,
    ) : SavedRow
}

/**
 * The saved page: stations and pairs in one list, as home shows them. The list is read once, as
 * the page opens, and edited from there: each pin, unpin and move is stored straight away, but an
 * unpinned row keeps its place until the page is left, so pinning it again puts it back where it
 * was. The web stages the same edits and stores them on leaving; storing as they happen means a
 * process death loses none of them.
 */
@HiltViewModel
class SavedStationsSettingsViewModel @Inject constructor(
    private val savedRepository: SavedRepository,
    private val stationRepository: StationRepository,
) : ViewModel() {

    /** The rows being edited; `null` until the saved list has been read. */
    private val rows = MutableStateFlow<List<EditableEntry>?>(null)
    private val stations = MutableStateFlow<Map<String, UIState<Station>>>(emptyMap())

    val state: StateFlow<UIState<List<SavedRow>>> = combine(rows.filterNotNull(), stations) { rows, stations ->
        UIState.Success(
            rows.mapIndexedNotNull { index, row ->
                val isFirst = index == 0
                val isLast = index == rows.lastIndex
                when (val entry = row.entry) {
                    is SavedEntry.Station -> {
                        val station = stations[entry.stationId] ?: UIState.Loading
                        // A station that didn't load has no name to show; the web drops its row too.
                        if (station is UIState.Error) {
                            return@mapIndexedNotNull null
                        }
                        SavedRow.StationRow(row.key, row.isSaved, station, isFirst, isLast)
                    }
                    // A pair whose station didn't load still shows, by its ids, so it can be removed.
                    is SavedEntry.Route -> SavedRow.RouteRow(
                        key = row.key,
                        isSaved = row.isSaved,
                        fromId = entry.fromId,
                        toId = entry.toId,
                        from = stations[entry.fromId] ?: UIState.Loading,
                        to = stations[entry.toId] ?: UIState.Loading,
                        isFirst = isFirst,
                        isLast = isLast,
                    )
                }
            },
        ) as UIState<List<SavedRow>>
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(5000),
        initialValue = UIState.Loading,
    )

    init {
        viewModelScope.launch {
            val entries = savedRepository.entries.first()
            rows.value = entries.map { EditableEntry(it) }
            entries.flatMap { entry ->
                when (entry) {
                    is SavedEntry.Station -> listOf(entry.stationId)
                    is SavedEntry.Route -> listOf(entry.fromId, entry.toId)
                }
            }.distinct().forEach(::load)

            // Every edit after that is stored as it happens, one write after another.
            rows.filterNotNull().drop(1).collect { edited ->
                savedRepository.replace(edited.committed())
            }
        }
    }

    fun onToggle(key: String) {
        rows.update { it?.toggle(key) }
    }

    /** Moves the row one place up ([offset] -1) or down (+1). */
    fun onMove(key: String, offset: Int) {
        rows.update { current ->
            val from = current?.indexOfFirst { it.key == key } ?: return@update current
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
