package id.shiorilabs.commute.feature.search.data

import arrow.core.Either
import id.shiorilabs.commute.core.type.Failure
import id.shiorilabs.commute.feature.search.domain.Searchable

interface SearchRepository {

    /**
     * Everything search can find. Fetched once per process and then served from memory: the index
     * changes with the API's data, not between two openings of the search screen.
     */
    suspend fun searchables(): Either<Failure, List<Searchable>>
}
