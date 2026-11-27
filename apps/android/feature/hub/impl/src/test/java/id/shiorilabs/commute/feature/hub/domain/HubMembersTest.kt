package id.shiorilabs.commute.feature.hub.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class HubMembersTest {

    private fun member(
        id: String,
        officialName: String,
        operator: String = "TJ",
        lines: List<String> = emptyList(),
    ) = HubMember(id, officialName.substringBefore(" Arah"), operator, lines, officialName)

    private val utara = member("TJ-1", "Kali Grogol Arah Utara")
    private val selatan = member("TJ-2", "Kali Grogol Arah Selatan")
    private val timur = member("TJ-3", "Pancoran Arah Timur")

    @Test
    fun directionLabelNamesTheSide() {
        assertEquals("Arah Utara", directionLabel(utara))
        assertEquals("Arah Selatan", directionLabel(selatan))
        assertNull(directionLabel(member("KCI-SUD", "Sudirman", "KCI")))
    }

    @Test
    fun headingFollowsTheCompass() {
        assertEquals(Heading.UP, headingOf(utara))
        assertEquals(Heading.DOWN, headingOf(selatan))
        assertEquals(Heading.RIGHT, headingOf(timur))
        assertEquals(Heading.LEFT, headingOf(member("TJ-4", "X arah barat")))
    }

    @Test
    fun aRightPointingSideTrails() {
        assertEquals(listOf(utara, timur), orderDirections(listOf(timur, utara)))
        assertEquals(listOf(utara, selatan), orderDirections(listOf(utara, selatan)))
    }

    @Test
    fun unsplitMembersHaveNoSides() {
        assertTrue(orderDirections(listOf(member("KCI-SUD", "Sudirman", "KCI"))).isEmpty())
    }

    @Test
    fun airportRailNeedsEveryLineToBeA() {
        assertTrue(isAirportRail(member("KCI-BPR", "Bandara", "KCI", listOf("KCI:A"))))
        assertFalse(isAirportRail(member("KCI-MRI", "Manggarai", "KCI", listOf("KCI:A", "KCI:B"))))
        assertFalse(isAirportRail(member("KCI-X", "X", "KCI")))
        assertEquals("ARL", tileLabel(member("KCI-BPR", "Bandara", "KCI", listOf("KCI:A"))))
        assertEquals("KRL", tileLabel(member("KCI-MRI", "Manggarai", "KCI", listOf("KCI:B"))))
        assertEquals("BRT", tileLabel(utara))
        assertEquals("LRT", tileLabel(member("LRTJ-X", "X", "LRTJBDB")))
        assertEquals("ZZZ", tileLabel(member("ZZZ-X", "X", "ZZZ")))
    }

    @Test
    fun groupsKeepApiOrder() {
        val kci = member("KCI-1", "A", "KCI")
        val groups = groupByOperator(listOf(utara, kci, selatan))
        assertEquals(listOf("TJ", "KCI"), groups.map { it.operator })
        assertEquals(listOf(utara, selatan), groups[0].members)
    }

    @Test
    fun resolveFallsBackToTheFirst() {
        assertEquals(selatan, resolveMember(listOf(utara, selatan), "TJ-2"))
        assertEquals(utara, resolveMember(listOf(utara, selatan), "nope"))
        assertEquals(utara, resolveMember(listOf(utara, selatan), null))
        assertNull(resolveMember(emptyList(), null))
    }
}
