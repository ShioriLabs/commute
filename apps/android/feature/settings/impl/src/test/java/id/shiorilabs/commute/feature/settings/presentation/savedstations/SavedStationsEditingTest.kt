package id.shiorilabs.commute.feature.settings.presentation.savedstations

import id.shiorilabs.commute.core.datastore.SavedEntry
import org.junit.Assert.assertEquals
import org.junit.Test

class SavedStationsEditingTest {

    private val rows = listOf("A", "B", "C").map { EditableEntry(SavedEntry.Station(it)) }

    @Test
    fun `move swaps neighbours`() {
        assertEquals(listOf("B", "A", "C"), rows.move(0, 1).map { it.key })
        assertEquals(listOf("A", "C", "B"), rows.move(2, 1).map { it.key })
    }

    @Test
    fun `move past either end leaves the list as it is`() {
        assertEquals(rows, rows.move(0, -1))
        assertEquals(rows, rows.move(2, 3))
    }

    @Test
    fun `toggle keeps the row in place and committed drops it`() {
        val edited = rows.toggle("B")

        assertEquals(listOf("A", "B", "C"), edited.map { it.key })
        assertEquals(listOf("A", "C").map(SavedEntry::Station), edited.committed())
        assertEquals(listOf("A", "B", "C").map(SavedEntry::Station), edited.toggle("B").committed())
    }

    @Test
    fun `a pair is keyed by its two ends, one way`() {
        val pairs = listOf(EditableEntry(SavedEntry.Route("A", "B")), EditableEntry(SavedEntry.Route("B", "A")))

        val edited = pairs.toggle("route:A>B")

        assertEquals(listOf(SavedEntry.Route("B", "A")), edited.committed())
    }
}
