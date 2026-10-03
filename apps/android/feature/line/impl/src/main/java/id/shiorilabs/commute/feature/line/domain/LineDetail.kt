package id.shiorilabs.commute.feature.line.domain

/** A line's topology: its trunk, then any branches and loops, each with its stations in order. */
data class LineDetail(
    /** e.g. `KCI`. */
    val operator: String,
    /** e.g. "Commuter Line". */
    val operatorName: String,
    val name: String,
    /** The bare code (`B`), what the roundel shows. */
    val lineCode: String,
    /** `#RRGGBB`. */
    val colorCode: String,
    /** The trunk first, as the API orders them. */
    val segments: List<LineSegment>,
)

/** One stretch of a line. */
data class LineSegment(
    val kind: SegmentKind,
    /** The code of the station this branch leaves the trunk at; null for the trunk. */
    val joinsAtCode: String?,
    val stations: List<LineStop>,
)

enum class SegmentKind {
    /** The main line. */
    TRUNK,

    /** A branch that carries on from the trunk and reads as the main line (Bogor). */
    CONTINUATION,

    /** A branch that peels off (Nambo). */
    RAMP,

    /** A branch that comes back round to the trunk (Cikarang's loop). */
    LOOP,

    /** A kind the API added after this build; the strip leaves it out. */
    UNKNOWN,
}

/** A station along a line. */
data class LineStop(
    /** `OPERATOR-CODE`, e.g. `KCI-SUD`. */
    val id: String,
    val code: String,
    val name: String,
    /** Its position along the line, e.g. `C13`, or `13-4` for a TransJakarta halte. */
    val stationNumber: String,
    /** A stop where the operator's other lines call too. */
    val isInterchange: Boolean,
    /** The operator's other lines that call here, as keys (`KCI:B`); this line is not among them. */
    val otherLines: List<String>,
)
