package id.shiorilabs.commute.feature.search.domain

/** A line as search shows it: enough for a roundel or a coloured pill. */
data class SearchLine(
    val name: String,
    /** The bare code written inside the roundel (`C`, `13`). */
    val lineCode: String,
    /** `#RRGGBB`. */
    val colorCode: String,
    val operator: String,
)

/**
 * One thing the rider can find: a station, a hub or a line, with the line keys the index carries
 * already resolved against its dictionary. Built by [toSearchables].
 */
sealed interface Searchable {

    val title: String

    /** The app path this result opens, e.g. `/stations/KCI/MRI`. Unique across the index. */
    val to: String

    /** Lowercase match targets, built by the server. */
    val keywords: List<String>
    val subtitle: String?

    /** Popularity, 0–100; absent means 0. */
    val score: Double?

    /** Identity that holds across index refreshes: the type plus where it leads. */
    val key: String

    data class Station(
        override val title: String,
        override val to: String,
        override val keywords: List<String>,
        override val subtitle: String?,
        override val score: Double?,
        /** `OPERATOR-CODE`, the id saved stations and recents are keyed by. */
        val stationId: String?,
        val operator: String,
        val lines: List<SearchLine>,
    ) : Searchable {
        override val key: String get() = "STATION:$to"
    }

    data class Hub(
        override val title: String,
        override val to: String,
        override val keywords: List<String>,
        override val subtitle: String?,
        override val score: Double?,
        val hubId: String?,
        /** Every member's lines; a hub can span operators, so it carries none of its own. */
        val lines: List<SearchLine>,
    ) : Searchable {
        override val key: String get() = "HUB:$to"
    }

    data class Line(
        override val title: String,
        override val to: String,
        override val keywords: List<String>,
        override val subtitle: String?,
        override val score: Double?,
        val operator: String,
        val line: SearchLine,
    ) : Searchable {
        override val key: String get() = "LINE:$to"
    }
}
