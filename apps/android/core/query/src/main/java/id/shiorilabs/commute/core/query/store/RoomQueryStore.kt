package id.shiorilabs.commute.core.query.store

import id.shiorilabs.commute.core.query.db.QueryEntryDao
import id.shiorilabs.commute.core.query.db.QueryEntryEntity
import javax.inject.Inject

internal class RoomQueryStore @Inject constructor(
    private val dao: QueryEntryDao,
) : QueryStore {

    override suspend fun get(key: String): StoredEntry? =
        dao.get(key)?.let { StoredEntry(it.key, it.body, it.etag, it.fetchedAt) }

    override suspend fun put(entry: StoredEntry) = dao.upsert(
        QueryEntryEntity(
            key = entry.key,
            body = entry.body,
            etag = entry.etag,
            fetchedAt = entry.fetchedAtMillis,
            lastUsedAt = entry.fetchedAtMillis,
            size = entry.body.length.toLong(),
        ),
    )

    override suspend fun confirm(key: String, fetchedAtMillis: Long, etag: String?) =
        dao.confirm(key, fetchedAtMillis, etag)

    override suspend fun markUsed(key: String, atMillis: Long) = dao.markUsed(key, atMillis)

    override suspend fun delete(key: String) = dao.delete(key)

    override suspend fun clear() = dao.clear()

    override suspend fun size(): Long = dao.totalSize()

    override suspend fun prune(unusedBeforeMillis: Long, maxSize: Long) = dao.prune(unusedBeforeMillis, maxSize)
}
