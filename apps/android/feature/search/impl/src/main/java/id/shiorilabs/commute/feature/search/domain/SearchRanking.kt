package id.shiorilabs.commute.feature.search.domain

/** Queries shorter than this show the idle rails instead of results, as on web. */
const val MIN_QUERY_LENGTH = 2

private class Scored(
    val searchable: Searchable,
    /** Match score plus the popularity term; what the threshold applies to. */
    val score: Double,
    /** Match score alone; what decides the tier. */
    val matchScore: Double,
    /** Sub-unit reorder applied at sort time only. */
    val sortNudge: Double,
)

/**
 * The search results for [query], best first. The scoring loop of the web's `search-content.tsx`:
 * each entry takes its best keyword's [keywordScore], adds `1 - popularity`, and is kept under
 * [SCORE_THRESHOLD]; only the best match tier survives ([filterBestTier]).
 *
 * Ties break by a nudge that prefers stations over lines and hubs, and rail over TransJakarta,
 * then by title. The nudge is always < 1 and is NOT folded into the thresholded score, so it can
 * only reorder close matches, never surface a poor one.
 */
fun rankSearchables(searchables: List<Searchable>, query: String): List<Searchable> {
    if (searchables.isEmpty() || query.length < MIN_QUERY_LENGTH) {
        return emptyList()
    }
    val needle = query.lowercase()

    val scored = searchables.mapNotNull { searchable ->
        var score = NO_MATCH
        for (keyword in searchable.keywords) {
            if (score == 0.0) {
                break
            }
            val keywordMatch = keywordScore(keyword, needle)
            if (keywordMatch < score) {
                score = keywordMatch
            }
        }

        val finalScore = score + (1 - popularityTerm(searchable.score))
        if (finalScore >= SCORE_THRESHOLD) {
            return@mapNotNull null
        }

        val isStation = searchable is Searchable.Station
        val isTransJakarta = searchable is Searchable.Station && searchable.operator == "TJ"
        Scored(
            searchable = searchable,
            score = finalScore,
            matchScore = score,
            sortNudge = (if (isStation) 0.0 else 0.4) + (if (isTransJakarta) 0.2 else 0.0),
        )
    }

    return filterBestTier(scored) { it.matchScore }
        .sortedWith(
            compareBy<Scored> { it.score + it.sortNudge }.thenBy { it.searchable.title },
        )
        .map { it.searchable }
}
