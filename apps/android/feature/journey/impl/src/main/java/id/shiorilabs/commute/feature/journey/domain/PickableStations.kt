package id.shiorilabs.commute.feature.journey.domain

import id.shiorilabs.commute.feature.station.domain.NearbyStation
import id.shiorilabs.commute.feature.search.domain.SCORE_THRESHOLD
import id.shiorilabs.commute.feature.search.domain.SearchLine
import id.shiorilabs.commute.feature.search.domain.Searchable
import id.shiorilabs.commute.feature.search.domain.filterBestTier
import id.shiorilabs.commute.feature.search.domain.keywordScore
import id.shiorilabs.commute.feature.search.domain.popularityTerm
import id.shiorilabs.commute.feature.station.domain.sortLineKeysForDisplay

/*
 * The stations the OTW picker offers, and how it orders them: the web's `pickable-station.ts` and
 * `station-ranking.ts`, ranked with the same fuzzy matcher search uses.
 */

/** Rows the picker shows before the rider has typed, most popular first. */
const val NO_QUERY_ROWS = 50

/** How many stations the "Sering dipilih" rail holds. */
const val QUICK_PICKS = 4

/** Below this the picker lists by popularity rather than matching. */
private const val MIN_QUERY_LENGTH = 2

data class PickableStation(
    /** `OPERATOR-CODE`. */
    val id: String,
    val name: String,
    val operator: String,
    /** In the order a station's roundels are drawn, as the station page does. */
    val lines: List<SearchLine>,
    val score: Double?,
    /** Directional halte twins folded into this row. */
    val siblingIds: List<String>,
    val keywords: List<String>,
)

fun toPickableStations(searchables: List<Searchable>): List<PickableStation> =
    searchables.mapNotNull { searchable ->
        val station = searchable as? Searchable.Station ?: return@mapNotNull null
        val id = station.stationId ?: return@mapNotNull null
        val byKey = station.lines.associateBy { "${station.operator}:${it.lineCode}" }
        PickableStation(
            id = id,
            name = station.title,
            operator = station.operator,
            lines = sortLineKeysForDisplay(byKey.keys.toList(), station.operator).mapNotNull { byKey[it] },
            score = station.score,
            siblingIds = station.siblingIds,
            keywords = station.keywords,
        )
    }

/**
 * The station [id] names, keeping [id] itself when it is a folded twin: a link names one direction
 * of a halte, and the request has to ask for that one.
 */
fun resolveStationId(stations: List<PickableStation>, id: String): PickableStation? {
    for (station in stations) {
        if (station.id == id) {
            return station
        }
        if (id in station.siblingIds) {
            return station.copy(id = id)
        }
    }
    return null
}

private val byPopularity = compareByDescending<PickableStation> { it.score ?: 0.0 }.thenBy { it.name }

fun topByPopularity(stations: List<PickableStation>, limit: Int): List<PickableStation> =
    if (limit <= 0) emptyList() else stations.sortedWith(byPopularity).take(limit)

/** The picker's rows for [query]: popularity when it is too short to match, else best match first. */
fun rankStations(stations: List<PickableStation>, query: String): List<PickableStation> {
    if (query.length < MIN_QUERY_LENGTH) {
        return topByPopularity(stations, NO_QUERY_ROWS)
    }
    val needle = query.lowercase()

    class Scored(val station: PickableStation, val matchScore: Double, val finalScore: Double)

    val scored = stations.mapNotNull { station ->
        var matchScore = Double.POSITIVE_INFINITY
        for (keyword in station.keywords) {
            val score = keywordScore(keyword, needle)
            if (score < matchScore) {
                matchScore = score
            }
            if (matchScore == 0.0) {
                break
            }
        }
        val finalScore = matchScore + (1 - popularityTerm(station.score))
        if (finalScore >= SCORE_THRESHOLD) null else Scored(station, matchScore, finalScore)
    }
    return filterBestTier(scored) { it.matchScore }
        .sortedWith(compareBy<Scored> { it.finalScore }.thenBy { it.station.name })
        .map { it.station }
}

/** The rider's recent picks first, topped up with the most popular stations to [QUICK_PICKS]. */
fun quickPickStations(stations: List<PickableStation>, recentIds: List<String>): List<PickableStation> {
    val byId = stations.associateBy { it.id }
    val picks = recentIds.mapNotNull { byId[it] }.distinctBy { it.id }.take(QUICK_PICKS).toMutableList()
    for (station in topByPopularity(stations, QUICK_PICKS + picks.size)) {
        if (picks.size == QUICK_PICKS) {
            break
        }
        if (picks.none { it.id == station.id }) {
            picks += station
        }
    }
    return picks
}

/**
 * The picker's rows for the stations near the rider, with their distances: each nearby station
 * matched to its row by id, or by a directional twin folded into one. Stations the picker doesn't
 * offer are left out.
 */
fun nearbyPicks(nearby: List<NearbyStation>, stations: List<PickableStation>): List<Pair<PickableStation, Int>> {
    val byId = buildMap {
        for (station in stations) {
            put(station.id, station)
            for (sibling in station.siblingIds) putIfAbsent(sibling, station)
        }
    }
    return nearby.mapNotNull { near -> byId[near.station.id]?.let { it to near.distanceM } }.distinctBy { it.first.id }
}
