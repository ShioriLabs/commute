package id.shiorilabs.commute.feature.station.domain

/** A station a rider can walk to from this one, and how far it is. */
sealed interface Transfer {

    val id: String

    /** The station walked to, as riders know it. */
    val name: String

    /** The walk, in metres. */
    val distanceM: Int

    /** Directions for the walk, when there is something to say. */
    val notes: String?

    /** A station on this API's network, with its lines. */
    data class Internal(
        override val id: String,
        override val distanceM: Int,
        override val notes: String?,
        /** `OPERATOR-CODE`. */
        val stationId: String,
        override val name: String,
        val operator: String,
        /** `OPERATOR:CODE`, resolved through [LineInfo] by whoever renders them. */
        val lineKeys: List<String>,
    ) : Transfer

    /** A service this API doesn't cover: only a name and its operator's, as plain text. */
    data class External(
        override val id: String,
        override val distanceM: Int,
        override val notes: String?,
        override val name: String,
        val operatorName: String,
    ) : Transfer
}
