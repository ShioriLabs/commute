package id.shiorilabs.commute.feature.station.domain

/** One exit or gate of a station, as the board at it prints it. */
data class StationExit(
    /** `OPERATOR-CODE:ref`. */
    val id: String,
    /** The signed text (`D`, `Utara`), as stored: a long one stretches its badge into a pill. */
    val ref: String,
    /** The street or landmark it opens onto; `null` until recorded. */
    val name: String?,
    /** The board's entries in the order printed; empty until the board is transcribed. */
    val signs: List<ExitSign>,
    /** Taken from OpenStreetMap, which has to be credited wherever it is shown. */
    val fromOsm: Boolean,
)

/** One line on an exit's sign board. */
data class ExitSign(
    /** As printed. */
    val text: String,
    /** The icon the board gives it, when it gives one. */
    val kind: SignKind?,
    /** `OPERATOR-CODE` of the station or halte the text names, when it names one. */
    val stationId: String?,
)

/** What the icon on a sign says its text is. */
enum class SignKind { RAIL, BUS }
