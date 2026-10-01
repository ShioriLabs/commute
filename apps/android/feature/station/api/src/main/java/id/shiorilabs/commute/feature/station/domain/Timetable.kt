package id.shiorilabs.commute.feature.station.domain

/** One departure. [minute] is minutes since local midnight, in Jakarta time. */
data class Departure(
    /** The operator's trip number, when it publishes one. */
    val tripNumber: String?,
    val minute: Int,
)

/** Every departure towards one terminus, earliest first. */
data class DestinationTimetable(
    val boundFor: String,
    /** Set when two runs to the same terminus take different routes. */
    val via: String?,
    val departures: List<Departure>,
)

/** One direction of travel from the station, as a departure board groups it. */
data class DirectionGroup(
    /** Stable across fetches. */
    val key: String,
    /** The stations the direction is signed with. */
    val label: List<String>,
    /** Curated platform, e.g. `3/4`. Null when unknown. */
    val platformCode: String?,
    val destinations: List<DestinationTimetable>,
)

/** One line's departures from a station, for one service day. */
data class LineTimetable(
    /** `OPERATOR:CODE`. */
    val lineKey: String,
    val groups: List<DirectionGroup>,
)
