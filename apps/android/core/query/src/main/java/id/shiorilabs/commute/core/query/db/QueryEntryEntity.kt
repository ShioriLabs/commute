package id.shiorilabs.commute.core.query.db

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.PrimaryKey

/**
 * One cached response: the wire model's JSON under its query key, the ETag it came with, and when
 * it was last confirmed (a 200, or a 304 that vouched for it) and last read.
 */
@Entity(tableName = "query_entry")
internal data class QueryEntryEntity(
    @PrimaryKey val key: String,
    val body: String,
    val etag: String?,
    @ColumnInfo(name = "fetched_at") val fetchedAt: Long,
    @ColumnInfo(name = "last_used_at", index = true) val lastUsedAt: Long,
    /** The body's length in UTF-16 code units: close enough to its bytes for a size cap. */
    val size: Long,
)
