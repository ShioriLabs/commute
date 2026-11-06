package id.shiorilabs.commute.feature.journey.domain

/** Which end of the pair the picker is filling. */
enum class PairEnd { ORIGIN, DESTINATION }

/** The two ends as station ids, either of which may be unset. */
data class StationPair(val fromId: String? = null, val toId: String? = null) {

    val isComplete: Boolean get() = fromId != null && toId != null

    fun swapped(): StationPair = StationPair(fromId = toId, toId = fromId)

    /**
     * Sets [end] to [stationId]. Picking the station already at the other end swaps the two rather
     * than asking for a trip from a station to itself, as the web's `handleSelect` does.
     */
    fun with(end: PairEnd, stationId: String): StationPair = when (end) {
        PairEnd.ORIGIN -> StationPair(
            fromId = stationId,
            toId = if (stationId == toId) fromId else toId,
        )

        PairEnd.DESTINATION -> StationPair(
            fromId = if (stationId == fromId) toId else fromId,
            toId = stationId,
        )
    }
}
