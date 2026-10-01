package id.shiorilabs.commute.feature.search.domain

import id.shiorilabs.commute.feature.search.hub
import id.shiorilabs.commute.feature.search.line
import id.shiorilabs.commute.feature.search.station
import org.junit.Assert.assertEquals
import org.junit.Test

class SearchRankingTest {

    @Test
    fun `a query under two characters returns nothing`() {
        assertEquals(emptyList<Searchable>(), rankSearchables(listOf(station("Karet", "KCI-KAT")), "k"))
    }

    @Test
    fun `matching ignores case`() {
        val karet = station("Karet", "KCI-KAT")

        assertEquals(listOf(karet), rankSearchables(listOf(karet), "KARET"))
    }

    @Test
    fun `an exact match hides typo matches`() {
        val karet = station("Karet", "KCI-KAT")
        val indomaret = station("Fatmawati Indomaret", "MRTJ-FTM")

        assertEquals(listOf(karet), rankSearchables(listOf(indomaret, karet), "karet"))
    }

    @Test
    fun `a typo still finds the station`() {
        val dukuhAtas = station("Dukuh Atas", "MRTJ-DKA", keywords = listOf("dukuh atas bni"))

        assertEquals(listOf(dukuhAtas), rankSearchables(listOf(dukuhAtas), "dukuj"))
    }

    @Test
    fun `within a tier the more popular station ranks first`() {
        val quiet = station("Sudirman Quiet", "KCI-SQ", keywords = listOf("sudirman"), score = 10.0)
        val busy = station("Sudirman Busy", "KCI-SB", keywords = listOf("sudirman"), score = 90.0)

        assertEquals(listOf(busy, quiet), rankSearchables(listOf(quiet, busy), "sudirman"))
    }

    @Test
    fun `stations rank before hubs and lines on an equal match`() {
        val cikarangStation = station("Cikarang", "KCI-CKR")
        val cikarangLine = line("Cikarang")
        val cikarangHub = hub("Cikarang", "cikarang")

        // Hubs and lines share one nudge, so between those two it is only the station that moves.
        val ranked = rankSearchables(listOf(cikarangLine, cikarangHub, cikarangStation), "cikarang")

        assertEquals(cikarangStation, ranked.first())
        assertEquals(3, ranked.size)
    }

    @Test
    fun `rail ranks before TransJakarta on an equal match`() {
        val tj = station("Senen", "TJ-SNN", operator = "TJ")
        val rail = station("Senen", "KCI-SEN")

        assertEquals(listOf(rail, tj), rankSearchables(listOf(tj, rail), "senen"))
    }

    @Test
    fun `equal scores fall back to the title`() {
        val b = station("Bogor B", "KCI-B", keywords = listOf("bogor"))
        val a = station("Bogor A", "KCI-A", keywords = listOf("bogor"))

        assertEquals(listOf(a, b), rankSearchables(listOf(b, a), "bogor"))
    }
}
