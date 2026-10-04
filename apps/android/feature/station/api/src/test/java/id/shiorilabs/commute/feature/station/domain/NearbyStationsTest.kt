package id.shiorilabs.commute.feature.station.domain

import id.shiorilabs.commute.core.geo.GeoPoint
import org.junit.Assert.assertEquals
import org.junit.Test

class NearbyStationsTest {

    private fun station(id: String, lat: Double?, lon: Double?) =
        Station(id = id, name = id, operator = id.substringBefore('-'), code = id.substringAfter('-'), lineKeys = emptyList(), latitude = lat, longitude = lon)

    private val sudirman = station("KCI-SUD", -6.2024, 106.8237)
    private val dukuhAtas = station("MRTJ-DKA", -6.2007, 106.8227)
    private val manggarai = station("KCI-MRI", -6.2099, 106.8502)
    private val nowhere = station("KCI-XXX", null, null)

    /** Outside the Sudirman exit. */
    private val here = GeoPoint(-6.2020, 106.8233)

    @Test
    fun `the nearest come first, and far ones are left out`() {
        val nearby = nearbyStations(here, listOf(manggarai, dukuhAtas, sudirman, nowhere))

        assertEquals(listOf("KCI-SUD", "MRTJ-DKA"), nearby.map { it.station.id })
        assertEquals(true, nearby.first().distanceM < 100)
    }

    @Test
    fun `at most the limit`() {
        assertEquals(1, nearbyStations(here, listOf(dukuhAtas, sudirman), limit = 1).size)
    }

    @Test
    fun `nothing nearby is an empty list`() {
        assertEquals(emptyList<NearbyStation>(), nearbyStations(GeoPoint(-6.6, 106.8), listOf(sudirman, dukuhAtas)))
    }
}
