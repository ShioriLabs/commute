package id.shiorilabs.commute.core.query

/**
 * Names one cached query, as a `/`-joined path from general to specific: `station/KCI-MRI`,
 * `station/KCI-MRI/timetable/WD`. Invalidating a key covers every key under it, so a station's
 * parts nest under the station.
 */
@JvmInline
value class QueryKey(val value: String) {

    /** Whether this key is [prefix] or nested under it. */
    fun isUnder(prefix: QueryKey): Boolean =
        value == prefix.value || value.startsWith(prefix.value + SEPARATOR)

    override fun toString(): String = value

    internal companion object {

        const val SEPARATOR = "/"
    }
}

/** A [QueryKey] from its parts, general to specific. A part must not contain `/`. */
fun queryKey(vararg parts: String): QueryKey {
    require(parts.isNotEmpty()) { "A query key needs at least one part" }
    require(parts.none { QueryKey.SEPARATOR in it || it.isEmpty() }) { "Bad query key part in ${parts.toList()}" }
    return QueryKey(parts.joinToString(QueryKey.SEPARATOR))
}
