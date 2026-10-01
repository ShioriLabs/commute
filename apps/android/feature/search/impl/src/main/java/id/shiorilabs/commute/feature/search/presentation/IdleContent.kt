package id.shiorilabs.commute.feature.search.presentation

import id.shiorilabs.commute.core.datastore.RecentSearch
import id.shiorilabs.commute.feature.search.domain.Searchable

/**
 * What search shows before the rider has typed enough to search: the pinned stations as chips under
 * the field, the recent searches as a list, then every line as a chip.
 */
data class IdleContent(
    /** Saved stations, in the order the rider arranged them. */
    val saved: List<Searchable.Station>,
    /** Stations and hubs, newest first. */
    val recents: List<Searchable>,
    val lines: List<Searchable.Line>,
)

/**
 * Builds the idle state from the index, resolving the saved and recent ids against it in their own
 * order. An id the index doesn't know (a station since retired, say) is skipped.
 */
fun idleContent(
    searchables: List<Searchable>,
    recents: List<RecentSearch>,
    savedStationIds: List<String>,
): IdleContent {
    val stations = searchables.filterIsInstance<Searchable.Station>()
        .filter { it.stationId != null }
        .associateBy { it.stationId }
    val hubs = searchables.filterIsInstance<Searchable.Hub>()
        .filter { it.hubId != null }
        .associateBy { it.hubId }

    return IdleContent(
        saved = savedStationIds.mapNotNull(stations::get),
        recents = recents.mapNotNull { recent ->
            when (recent.type) {
                RecentSearch.Type.STATION -> stations[recent.id]
                RecentSearch.Type.HUB -> hubs[recent.id]
            }
        },
        lines = searchables.filterIsInstance<Searchable.Line>(),
    )
}
