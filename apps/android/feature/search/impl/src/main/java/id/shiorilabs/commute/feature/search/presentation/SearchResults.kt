package id.shiorilabs.commute.feature.search.presentation

import id.shiorilabs.commute.feature.search.domain.Searchable

/** What the results area shows for the current query. */
sealed interface SearchResults {

    /** The query is too short to search; the idle state shows instead. */
    data object None : SearchResults

    data class Found(
        /** The query these were ranked for, which is what gets highlighted in their titles. */
        val query: String,
        val items: List<Searchable>,
    ) : SearchResults

    data class NotFound(val query: String) : SearchResults
}

/** Everything the search screen renders once the index is loaded. */
data class SearchUiState(
    val idle: IdleContent,
    val results: SearchResults,
    /** Saved station ids, for the pin on every station row. */
    val savedStationIds: Set<String>,
)
