package id.shiorilabs.commute.feature.search.domain

import id.shiorilabs.commute.core.model.models.SearchableHub
import id.shiorilabs.commute.core.model.models.SearchableIndex
import id.shiorilabs.commute.core.model.models.SearchableLine
import id.shiorilabs.commute.core.model.models.SearchableLineEntry
import id.shiorilabs.commute.core.model.models.SearchableStation
import org.junit.Assert.assertEquals
import org.junit.Test

class SearchableMapperTest {

    private val bogor = SearchableLine("Lin Bogor", "B", "#EE3D43", "KCI")
    private val cikarang = SearchableLine("Lin Cikarang", "C", "#25B8EB", "KCI")

    private fun index(vararg items: id.shiorilabs.commute.core.model.models.Searchable) = SearchableIndex(
        lines = mapOf("KCI:B" to bogor, "KCI:C" to cikarang),
        items = items.toList(),
    )

    @Test
    fun `a station's line keys resolve to its lines, in order`() {
        val result = index(
            SearchableStation(
                title = "Manggarai",
                to = "/stations/KCI/MRI",
                keywords = listOf("manggarai"),
                `data` = mapOf("station-id" to "KCI-MRI"),
                score = 95.0,
                `operator` = "KCI",
                lineKeys = listOf("KCI:C", "KCI:B"),
            ),
        ).toSearchables().single() as Searchable.Station

        assertEquals("KCI-MRI", result.stationId)
        assertEquals("KCI", result.operator)
        assertEquals(listOf("C", "B"), result.lines.map { it.lineCode })
    }

    @Test
    fun `a folded halte keeps its twins' ids, without its own`() {
        val result = index(
            SearchableStation(
                title = "Bundaran HI",
                to = "/stations/TJ/H00001",
                keywords = listOf("bundaran hi"),
                `data` = mapOf("station-id" to "TJ-H00001", "station-ids" to "TJ-H00001,TJ-H00001P,"),
                `operator` = "TJ",
                lineKeys = emptyList(),
            ),
        ).toSearchables().single() as Searchable.Station

        assertEquals(listOf("TJ-H00001P"), result.siblingIds)
    }

    @Test
    fun `a line key missing from the dictionary is dropped from a hub`() {
        val result = index(
            SearchableHub(
                title = "Dukuh Atas",
                to = "/hubs/dukuh-atas",
                keywords = listOf("dukuh atas"),
                `data` = mapOf("hub-id" to "dukuh-atas"),
                lineKeys = listOf("KCI:B", "MRTJ:M"),
            ),
        ).toSearchables().single() as Searchable.Hub

        assertEquals("dukuh-atas", result.hubId)
        assertEquals(listOf("B"), result.lines.map { it.lineCode })
    }

    @Test
    fun `a line entry whose key is missing is dropped whole`() {
        val entry = { key: String ->
            SearchableLineEntry(
                title = "Lin",
                to = "/lines/KCI/$key",
                keywords = listOf("lin"),
                `operator` = "KCI",
                lineKey = key,
            )
        }

        val result = index(entry("KCI:C"), entry("KCI:Z")).toSearchables()

        assertEquals(listOf("C"), result.map { (it as Searchable.Line).line.lineCode })
    }
}
