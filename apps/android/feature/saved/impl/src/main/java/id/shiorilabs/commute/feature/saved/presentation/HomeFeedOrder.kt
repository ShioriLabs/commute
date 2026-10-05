package id.shiorilabs.commute.feature.saved.presentation

/** Home's entries split in two: those lifted to the top while the rider is at them, then the rest. */
internal data class RaisedFeed(val front: List<HomeEntry>, val rest: List<HomeEntry>)

/**
 * Lifts what home has pinned at the stations the rider is at ([raised], nearest first) to the top:
 * each station's own board, then the pairs that start there, in the rider's order. The rest keep
 * their places.
 */
internal fun raiseNearby(entries: List<HomeEntry>, raised: List<String>): RaisedFeed {
    if (raised.isEmpty()) return RaisedFeed(emptyList(), entries)
    val front = raised.flatMap { stationId ->
        entries.filter { entry ->
            when (entry) {
                is HomeEntry.StationEntry -> entry.board.stationId == stationId
                is HomeEntry.RouteEntry -> entry.fromId == stationId
            }
        }.sortedBy { it is HomeEntry.RouteEntry }
    }.distinct()
    return RaisedFeed(front, entries - front.toSet())
}
