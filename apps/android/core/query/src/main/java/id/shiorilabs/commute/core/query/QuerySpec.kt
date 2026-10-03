package id.shiorilabs.commute.core.query

import id.shiorilabs.commute.core.type.Fetched
import kotlinx.serialization.KSerializer

/**
 * Everything [QueryClient] needs to serve one query: its [key], how to store the answer
 * ([serializer], a wire model's), when it goes stale ([policy]), and how to ask for it ([fetch]).
 *
 * @property isUsable Whether an answer is worth keeping as it is. One that isn't (an empty board,
 *   say) is still shown, but counts as stale, so the next observer asks again.
 * @property fetch Asks the API, sending the held copy's ETag when there is one; see
 *   [id.shiorilabs.commute.core.type.Fetched].
 */
class QuerySpec<T>(
    val key: QueryKey,
    val serializer: KSerializer<T>,
    val policy: QueryPolicy,
    val isUsable: (T) -> Boolean = { true },
    val fetch: suspend (etag: String?) -> Fetched<T>,
)
