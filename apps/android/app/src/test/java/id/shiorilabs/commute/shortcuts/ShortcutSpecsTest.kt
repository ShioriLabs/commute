package id.shiorilabs.commute.shortcuts

import id.shiorilabs.commute.core.datastore.SavedEntry
import org.junit.Assert.assertEquals
import org.junit.Test

class ShortcutSpecsTest {

    private val names = mapOf(
        "KCI-MRI" to "Manggarai",
        "KCI-JNG" to "Jatinegara",
        "KCI-SUD" to "Sudirman",
        "KCI-BOO" to "Bogor",
        "MRTJ-DKA" to "Dukuh Atas",
    )

    private fun station(id: String) = SavedEntry.Station(id)
    private fun route(from: String, to: String) = SavedEntry.Route(from, to)

    private fun ids(entries: List<SavedEntry>, slots: Int = 4, names: Map<String, String> = this.names) =
        buildShortcutSpecs(entries, names, otwLabel = "OTW", slots = slots).map { it.id }

    @Test
    fun `no pins is only OTW`() {
        assertEquals(listOf("otw"), ids(emptyList()))
    }

    @Test
    fun `routes come first, then stations, then OTW`() {
        val entries = listOf(station("KCI-SUD"), route("KCI-MRI", "KCI-JNG"), station("KCI-BOO"))
        assertEquals(
            listOf("route:KCI-MRI:KCI-JNG", "station:KCI-SUD", "station:KCI-BOO", "otw"),
            ids(entries),
        )
    }

    @Test
    fun `two or more routes leave one station`() {
        val entries = listOf(
            route("KCI-MRI", "KCI-JNG"),
            route("KCI-JNG", "KCI-MRI"),
            route("KCI-SUD", "KCI-BOO"),
            station("KCI-SUD"),
            station("KCI-BOO"),
        )
        assertEquals(
            listOf("route:KCI-MRI:KCI-JNG", "route:KCI-JNG:KCI-MRI", "station:KCI-SUD", "otw"),
            ids(entries),
        )
    }

    @Test
    fun `one route leaves two stations`() {
        val entries = listOf(route("KCI-MRI", "KCI-JNG"), station("KCI-SUD"), station("KCI-BOO"), station("MRTJ-DKA"))
        assertEquals(
            listOf("route:KCI-MRI:KCI-JNG", "station:KCI-SUD", "station:KCI-BOO", "otw"),
            ids(entries),
        )
    }

    @Test
    fun `no stations lets a third route in`() {
        val entries = listOf(
            route("KCI-MRI", "KCI-JNG"),
            route("KCI-JNG", "KCI-MRI"),
            route("KCI-SUD", "KCI-BOO"),
            route("KCI-BOO", "KCI-SUD"),
        )
        assertEquals(
            listOf("route:KCI-MRI:KCI-JNG", "route:KCI-JNG:KCI-MRI", "route:KCI-SUD:KCI-BOO", "otw"),
            ids(entries),
        )
    }

    @Test
    fun `three stations and no routes`() {
        val entries = listOf(station("KCI-MRI"), station("KCI-JNG"), station("KCI-SUD"), station("KCI-BOO"))
        assertEquals(listOf("station:KCI-MRI", "station:KCI-JNG", "station:KCI-SUD", "otw"), ids(entries))
    }

    @Test
    fun `entries with an unknown name are left out`() {
        val entries = listOf(route("KCI-MRI", "KCI-XXX"), station("KCI-XXX"), station("KCI-SUD"))
        assertEquals(listOf("station:KCI-SUD", "otw"), ids(entries))
    }

    @Test
    fun `a short launcher gives way to OTW's slot only`() {
        val entries = listOf(route("KCI-MRI", "KCI-JNG"), station("KCI-SUD"), station("KCI-BOO"))
        assertEquals(listOf("route:KCI-MRI:KCI-JNG", "otw"), ids(entries, slots = 2))
        assertEquals(listOf("otw"), ids(entries, slots = 1))
        assertEquals(emptyList<String>(), ids(entries, slots = 0))
    }

    @Test
    fun `links open the matching web page`() {
        val specs = buildShortcutSpecs(
            listOf(route("KCI-MRI", "KCI-JNG"), station("KCI-SUD")),
            names,
            otwLabel = "OTW",
            slots = 4,
        )
        assertEquals("Manggarai → Jatinegara", specs[0].label)
        assertEquals("https://commute.shiorilabs.id/fare?from=KCI-MRI&to=KCI-JNG", specs[0].link)
        assertEquals("https://commute.shiorilabs.id/stations/KCI/SUD", specs[1].link)
        assertEquals("https://commute.shiorilabs.id/fare", specs[2].link)
    }
}
