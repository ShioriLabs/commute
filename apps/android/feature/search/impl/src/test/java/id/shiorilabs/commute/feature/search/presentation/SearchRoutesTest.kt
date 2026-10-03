package id.shiorilabs.commute.feature.search.presentation

import id.shiorilabs.commute.core.navigation.Route
import id.shiorilabs.commute.feature.search.hub
import id.shiorilabs.commute.feature.search.line
import id.shiorilabs.commute.feature.search.lineBogor
import id.shiorilabs.commute.feature.search.station
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SearchRoutesTest {

    @Test
    fun `a station opens its page with its name and roundels`() {
        assertEquals(
            Route.Station("KCI-MRI", title = "Manggarai", lineKeys = listOf("KCI:B")),
            routeFor(station("Manggarai", "KCI-MRI")),
        )
    }

    @Test
    fun `a hub opens its page by slug, from its link when it has no id`() {
        assertEquals(Route.Hub("dukuh-atas", title = "Dukuh Atas"), routeFor(hub("Dukuh Atas", "dukuh-atas")))
        assertEquals(
            Route.Hub("dukuh-atas", title = "Dukuh Atas"),
            routeFor(hub("Dukuh Atas", "dukuh-atas").copy(hubId = null)),
        )
        assertNull(routeFor(hub("Dukuh Atas", "dukuh-atas").copy(hubId = null, to = "/somewhere")))
    }

    @Test
    fun `a line opens its page with its name and colour`() {
        assertEquals(
            Route.Line("KCI", "B", title = "Lin Bogor", colorCode = "#EE3D43"),
            routeFor(line("Lin Bogor", lineBogor)),
        )
    }
}
