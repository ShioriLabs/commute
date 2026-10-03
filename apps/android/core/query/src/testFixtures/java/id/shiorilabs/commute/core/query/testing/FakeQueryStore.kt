package id.shiorilabs.commute.core.query.testing

import id.shiorilabs.commute.core.query.store.QueryStore
import id.shiorilabs.commute.core.query.store.StoredEntry

/**
 * In-memory [QueryStore]: the disk half of the cache for JVM tests. [entries] is open, so a test can
 * seed what a previous launch left behind, or read back what was written.
 */
class FakeQueryStore : QueryStore {

    val entries = linkedMapOf<String, StoredEntry>()

    /** When each key was last read or written, for [prune]. */
    val lastUsed = mutableMapOf<String, Long>()

    /** How many times [put] wrote a body — for asserting that a 304 doesn't. */
    var puts: Int = 0
        private set

    /** Makes every call throw, as a broken disk would. */
    var broken: Boolean = false

    override suspend fun get(key: String): StoredEntry? = check { entries[key] }

    override suspend fun put(entry: StoredEntry) = check {
        puts++
        entries[entry.key] = entry
        lastUsed[entry.key] = entry.fetchedAtMillis
    }

    override suspend fun confirm(key: String, fetchedAtMillis: Long, etag: String?) = check {
        entries[key]?.let { entries[key] = it.copy(fetchedAtMillis = fetchedAtMillis, etag = etag ?: it.etag) }
        lastUsed[key] = fetchedAtMillis
    }

    override suspend fun markUsed(key: String, atMillis: Long) = check {
        if (key in entries) lastUsed[key] = atMillis
    }

    override suspend fun delete(key: String) = check {
        entries.remove(key)
        lastUsed.remove(key)
        Unit
    }

    override suspend fun clear() = check {
        entries.clear()
        lastUsed.clear()
    }

    override suspend fun size(): Long = check { entries.values.sumOf { it.body.length.toLong() } }

    override suspend fun prune(unusedBeforeMillis: Long, maxSize: Long) = check {
        entries.keys.filter { (lastUsed[it] ?: 0) < unusedBeforeMillis }.forEach { entries.remove(it) }
        var excess = entries.values.sumOf { it.body.length.toLong() } - maxSize
        for (key in entries.keys.sortedBy { lastUsed[it] ?: 0 }) {
            if (excess <= 0) break
            excess -= entries.getValue(key).body.length
            entries.remove(key)
        }
    }

    private inline fun <R> check(block: () -> R): R {
        if (broken) throw IllegalStateException("The disk is broken")
        return block()
    }
}
