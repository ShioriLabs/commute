package id.shiorilabs.commute.core.query.store

/** One stored response, as [QueryStore] keeps it: JSON, its ETag, and when it was confirmed. */
data class StoredEntry(
    val key: String,
    val body: String,
    val etag: String?,
    val fetchedAtMillis: Long,
)

/**
 * The disk half of the query cache: a key-value store of response bodies. An interface so
 * [id.shiorilabs.commute.core.query.QueryClient] runs on the JVM in tests against an in-memory one.
 */
interface QueryStore {

    suspend fun get(key: String): StoredEntry?

    suspend fun put(entry: StoredEntry)

    /** A 304 vouched for [key]'s stored body as of [fetchedAtMillis]; [etag] replaces its ETag if given. */
    suspend fun confirm(key: String, fetchedAtMillis: Long, etag: String?)

    /** Records a read, so the LRU keeps what riders actually open. */
    suspend fun markUsed(key: String, atMillis: Long)

    suspend fun delete(key: String)

    suspend fun clear()

    /** Roughly how many bytes the stored bodies take. */
    suspend fun size(): Long

    /**
     * Drops what hasn't been read since [unusedBeforeMillis], then the least recently used entries
     * until the rest fits in [maxSize].
     */
    suspend fun prune(unusedBeforeMillis: Long, maxSize: Long)
}
