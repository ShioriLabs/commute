package id.shiorilabs.commute.feature.search.presentation

import id.shiorilabs.commute.core.datastore.RecentSearch
import id.shiorilabs.commute.feature.search.hub
import id.shiorilabs.commute.feature.search.line
import id.shiorilabs.commute.feature.search.station
import org.junit.Assert.assertEquals
import org.junit.Test

class IdleContentTest {

    private val manggarai = station("Manggarai", "KCI-MRI")
    private val sudirman = station("Sudirman", "KCI-SUD")
    private val dukuhAtas = hub("Dukuh Atas", "dukuh-atas")
    private val cikarang = line("Lin Cikarang")
    private val index = listOf(manggarai, sudirman, dukuhAtas, cikarang)

    @Test
    fun `recents resolve stations and hubs in their own order`() {
        val idle = idleContent(
            searchables = index,
            recents = listOf(
                RecentSearch(RecentSearch.Type.HUB, "dukuh-atas"),
                RecentSearch(RecentSearch.Type.STATION, "KCI-MRI"),
            ),
            savedStationIds = emptyList(),
        )

        assertEquals(listOf(dukuhAtas, manggarai), idle.recents)
    }

    @Test
    fun `saved stations keep the rider's order`() {
        val idle = idleContent(index, emptyList(), savedStationIds = listOf("KCI-SUD", "KCI-MRI"))

        assertEquals(listOf(sudirman, manggarai), idle.saved)
    }

    @Test
    fun `an id the index does not know is skipped`() {
        val idle = idleContent(
            searchables = index,
            recents = listOf(RecentSearch(RecentSearch.Type.HUB, "gone")),
            savedStationIds = listOf("KCI-GONE", "KCI-SUD"),
        )

        assertEquals(emptyList<Any>(), idle.recents)
        assertEquals(listOf(sudirman), idle.saved)
    }

    @Test
    fun `every line becomes a chip`() {
        assertEquals(listOf(cikarang), idleContent(index, emptyList(), emptyList()).lines)
    }
}
