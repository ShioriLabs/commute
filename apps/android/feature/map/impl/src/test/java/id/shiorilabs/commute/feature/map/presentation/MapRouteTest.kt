package id.shiorilabs.commute.feature.map.presentation

import id.shiorilabs.commute.feature.journey.domain.PairEnd
import id.shiorilabs.commute.feature.journey.domain.StationPair
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class MapRouteTest {

    @Test
    fun `a station tapped fills the armed end`() {
        assertEquals(StationPair("KCI-SUD", "MRTJ-LBB"), StationPair(toId = "MRTJ-LBB").pickedOnMap(PairEnd.ORIGIN, "KCI-SUD"))
        assertEquals(StationPair("KCI-SUD", "KCI-MRI"), StationPair("KCI-SUD", "MRTJ-LBB").pickedOnMap(PairEnd.DESTINATION, "KCI-MRI"))
    }

    @Test
    fun `the station already at the other end isn't taken`() {
        assertNull(StationPair(toId = "MRTJ-LBB").pickedOnMap(PairEnd.ORIGIN, "MRTJ-LBB"))
        assertNull(StationPair(fromId = "KCI-SUD").pickedOnMap(PairEnd.DESTINATION, "KCI-SUD"))
    }

    @Test
    fun `either end set is a route to draw`() {
        assertEquals(false, MapRoute().isSet)
        assertEquals(true, MapRoute(StationPair(toId = "MRTJ-LBB")).isSet)
    }
}
