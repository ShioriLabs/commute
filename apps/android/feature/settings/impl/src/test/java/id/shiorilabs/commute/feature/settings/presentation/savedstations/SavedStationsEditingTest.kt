package id.shiorilabs.commute.feature.settings.presentation.savedstations

import org.junit.Assert.assertEquals
import org.junit.Test

class SavedStationsEditingTest {

    private val rows = listOf(EditableStation("A"), EditableStation("B"), EditableStation("C"))

    @Test
    fun `move swaps neighbours`() {
        assertEquals(listOf("B", "A", "C"), rows.move(0, 1).map { it.id })
        assertEquals(listOf("A", "C", "B"), rows.move(2, 1).map { it.id })
    }

    @Test
    fun `move past either end leaves the list as it is`() {
        assertEquals(rows, rows.move(0, -1))
        assertEquals(rows, rows.move(2, 3))
    }

    @Test
    fun `toggle keeps the row in place and committed drops it`() {
        val edited = rows.toggle("B")

        assertEquals(listOf("A", "B", "C"), edited.map { it.id })
        assertEquals(listOf("A", "C"), edited.committed())
        assertEquals(listOf("A", "B", "C"), edited.toggle("B").committed())
    }
}
