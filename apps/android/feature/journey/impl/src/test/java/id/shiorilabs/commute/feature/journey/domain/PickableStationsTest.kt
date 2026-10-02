package id.shiorilabs.commute.feature.journey.domain

import id.shiorilabs.commute.feature.search.domain.SearchLine
import id.shiorilabs.commute.feature.search.domain.Searchable
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PickableStationsTest {

    private fun station(
        id: String,
        title: String,
        score: Double? = null,
        operator: String = id.substringBefore('-'),
        siblingIds: List<String> = emptyList(),
        lines: List<SearchLine> = emptyList(),
    ) = Searchable.Station(
        title = title,
        to = "/stations/${id.replace('-', '/')}",
        keywords = listOf(title.lowercase(), id.substringAfter('-').lowercase()),
        subtitle = null,
        score = score,
        stationId = id,
        operator = operator,
        lines = lines,
        siblingIds = siblingIds,
    )

    private val searchables = listOf(
        station("KCI-MRI", "Manggarai", score = 95.0),
        station("KCI-SUD", "Sudirman", score = 90.0),
        station("MRTJ-LBB", "Lebak Bulus Grab", score = 80.0),
        station("TJ-H00001", "Bundaran HI", score = 70.0, siblingIds = listOf("TJ-H00001P")),
        Searchable.Line("Lin Bogor", "/lines/KCI/B", listOf("lin bogor"), null, null, "KCI", SearchLine("Lin Bogor", "B", "#EE3D43", "KCI")),
    )

    private val stations = toPickableStations(searchables)

    @Test
    fun `only stations with an id are pickable`() {
        assertEquals(listOf("KCI-MRI", "KCI-SUD", "MRTJ-LBB", "TJ-H00001"), stations.map { it.id })
    }

    @Test
    fun `a folded twin resolves to its row, keeping its own id`() {
        assertEquals("Bundaran HI", resolveStationId(stations, "TJ-H00001P")?.name)
        assertEquals("TJ-H00001P", resolveStationId(stations, "TJ-H00001P")?.id)
        assertNull(resolveStationId(stations, "KCI-XXX"))
    }

    @Test
    fun `without a query the picker lists by popularity`() {
        assertEquals("Manggarai", rankStations(stations, "m").first().name)
    }

    @Test
    fun `a query ranks by match, typos included`() {
        assertEquals(listOf("Sudirman"), rankStations(stations, "sudirm").map { it.name })
        assertEquals(listOf("Lebak Bulus Grab"), rankStations(stations, "lebak bulsu").map { it.name })
    }

    @Test
    fun `quick picks lead with recents, topped up by popularity`() {
        val picks = quickPickStations(stations, listOf("TJ-H00001", "KCI-GONE"))

        assertEquals(listOf("TJ-H00001", "KCI-MRI", "KCI-SUD", "MRTJ-LBB"), picks.map { it.id })
    }
}
