package id.shiorilabs.commute.feature.settings.presentation.savedstations

import id.shiorilabs.commute.core.datastore.SavedEntry

/** An entry's identity on the page: a station is its id, a pair its two ends, as the web's `entryKey`. */
val SavedEntry.key: String
    get() = when (this) {
        is SavedEntry.Station -> stationId
        is SavedEntry.Route -> "route:$fromId>$toId"
    }

/**
 * A row on the saved page: a pinned station or pair. An unpinned row stays in place until the page
 * is left, so pinning it again puts it back where it was.
 */
data class EditableEntry(
    val entry: SavedEntry,
    val isSaved: Boolean = true,
) {

    val key: String get() = entry.key
}

/**
 * Moves the entry at [from] to [to], the web's `moveEntry`. Out-of-range positions leave the list
 * as it is, so the ends don't wrap around.
 */
fun List<EditableEntry>.move(from: Int, to: Int): List<EditableEntry> {
    if (from !in indices || to !in indices || from == to) {
        return this
    }
    return toMutableList().apply { add(to, removeAt(from)) }
}

/** Flips the pin on the entry keyed [key], keeping its position. */
fun List<EditableEntry>.toggle(key: String): List<EditableEntry> =
    map { if (it.key == key) it.copy(isSaved = !it.isSaved) else it }

/** What gets stored: the pinned entries, in the page's order. */
fun List<EditableEntry>.committed(): List<SavedEntry> = filter { it.isSaved }.map { it.entry }
