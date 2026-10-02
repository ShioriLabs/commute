package id.shiorilabs.commute.feature.settings.presentation.savedstations

/**
 * A row on the saved stations page. An unpinned row stays in place until the page is left, so
 * pinning it again puts it back where it was.
 */
data class EditableStation(
    /** `OPERATOR-CODE`. */
    val id: String,
    val isSaved: Boolean = true,
)

/**
 * Moves the entry at [from] to [to], the web's `moveEntry`. Out-of-range positions leave the list
 * as it is, so the ends don't wrap around.
 */
fun List<EditableStation>.move(from: Int, to: Int): List<EditableStation> {
    if (from !in indices || to !in indices || from == to) {
        return this
    }
    return toMutableList().apply { add(to, removeAt(from)) }
}

/** Flips the pin on [id], keeping its position. */
fun List<EditableStation>.toggle(id: String): List<EditableStation> =
    map { if (it.id == id) it.copy(isSaved = !it.isSaved) else it }

/** What gets stored: the pinned rows, in the page's order. */
fun List<EditableStation>.committed(): List<String> = filter { it.isSaved }.map { it.id }
