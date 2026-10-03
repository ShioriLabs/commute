package id.shiorilabs.commute.core.query.db

import androidx.room.Dao
import androidx.room.Query
import androidx.room.Transaction
import androidx.room.Upsert

@Dao
internal interface QueryEntryDao {

    @Query("SELECT * FROM query_entry WHERE `key` = :key")
    suspend fun get(key: String): QueryEntryEntity?

    @Upsert
    suspend fun upsert(entry: QueryEntryEntity)

    /** A 304: the stored body is confirmed current as of [fetchedAt]. */
    @Query("UPDATE query_entry SET fetched_at = :fetchedAt, last_used_at = :fetchedAt, etag = COALESCE(:etag, etag) WHERE `key` = :key")
    suspend fun confirm(key: String, fetchedAt: Long, etag: String?)

    @Query("UPDATE query_entry SET last_used_at = :lastUsedAt WHERE `key` = :key")
    suspend fun markUsed(key: String, lastUsedAt: Long)

    @Query("DELETE FROM query_entry WHERE `key` = :key")
    suspend fun delete(key: String)

    @Query("DELETE FROM query_entry")
    suspend fun clear()

    @Query("SELECT COALESCE(SUM(size), 0) FROM query_entry")
    suspend fun totalSize(): Long

    @Query("DELETE FROM query_entry WHERE last_used_at < :before")
    suspend fun deleteUnusedSince(before: Long)

    /** Keys from least to most recently used, with their sizes, for evicting down to a cap. */
    @Query("SELECT `key`, size FROM query_entry ORDER BY last_used_at ASC")
    suspend fun byLeastRecentlyUsed(): List<KeySize>

    @Query("DELETE FROM query_entry WHERE `key` IN (:keys)")
    suspend fun deleteAll(keys: List<String>)

    /**
     * Drops entries nobody has read since [unusedBefore], then the least recently used ones until
     * what is left fits in [maxSize].
     */
    @Transaction
    suspend fun prune(unusedBefore: Long, maxSize: Long) {
        deleteUnusedSince(unusedBefore)
        var excess = totalSize() - maxSize
        if (excess <= 0) return
        val evicted = buildList {
            for (entry in byLeastRecentlyUsed()) {
                if (excess <= 0) break
                add(entry.key)
                excess -= entry.size
            }
        }
        // SQLite caps bound parameters; evict in chunks well under it.
        evicted.chunked(500).forEach { deleteAll(it) }
    }
}

internal data class KeySize(val key: String, val size: Long)
