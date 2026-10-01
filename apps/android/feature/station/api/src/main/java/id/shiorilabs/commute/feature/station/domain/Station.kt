package id.shiorilabs.commute.feature.station.domain

/** A station as the cards that show it need it. */
data class Station(
    /** `OPERATOR-CODE`, e.g. `KCI-MRI`. */
    val id: String,
    val name: String,
    val operator: String,
    /** The operator's own code, e.g. `MRI`. */
    val code: String,
    /** Line keys (`KCI:C`), resolved through [LineInfo] by whoever renders them. */
    val lineKeys: List<String>,
)

/** A line's name and colour, from the API's line dictionary. */
data class LineInfo(
    val name: String,
    /** The bare code (`C`), what a roundel shows. */
    val lineCode: String,
    /** `#RRGGBB`. */
    val colorCode: String,
    val operator: String,
)

/** The part of a line key (`KCI:C`) after the operator: `C`. Empty for an empty key. */
fun codeOfLineKey(key: String): String = key.substringAfter(':', key)
