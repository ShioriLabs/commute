package id.shiorilabs.commute.core.navigation

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class DeepLinksTest {

    @Test
    fun `a shared fare link naming a journey opens it with everything it carries`() {
        val route = routeForLink(
            "https://commute.shiorilabs.id/fare?from=KCI-SUD&to=MRTJ-LBB&paymentMethod=QRIS_TAP" +
                "&at=2026-10-05T03%3A20%3A00Z&modes=rail&walking=SLOW&j=C.SUD-MRI%7E_DKA",
        )

        assertEquals(
            Route.Trip(
                fromId = "KCI-SUD",
                toId = "MRTJ-LBB",
                journeyKey = "C.SUD-MRI~_DKA",
                paymentMethod = "QRIS_TAP",
                at = "2026-10-05T03:20:00Z",
                modes = "rail",
                walking = "SLOW",
            ),
            route,
        )
    }

    @Test
    fun `a saved pair's row link names the boarding too`() {
        assertEquals(
            Route.Trip(fromId = "KCI-SUD", toId = "KCI-MRI", journeyKey = "C.SUD-MRI", boardingClock = "2321"),
            routeForLink("https://commute.shiorilabs.id/fare?from=KCI-SUD&to=KCI-MRI&j=C.SUD-MRI&jt=2321"),
        )
    }

    @Test
    fun `a fare link without a journey opens the OTW tab with what it carries`() {
        assertEquals(Route.Otw(toId = "KCI-MRI"), routeForLink("https://commute.shiorilabs.id/fare?to=KCI-MRI"))
        assertEquals(Route.Otw(), routeForLink("https://commute.shiorilabs.id/fare/"))
        assertEquals(
            Route.Otw(fromId = "KCI-SUD", toId = "KCI-MRI", modes = "rail"),
            routeForLink("https://commute.shiorilabs.id/fare?from=KCI-SUD&to=KCI-MRI&modes=rail"),
        )
    }

    @Test
    fun `a journey without both ends has nowhere to be found, so opens the OTW tab`() {
        assertEquals(Route.Otw(toId = "KCI-MRI"), routeForLink("https://commute.shiorilabs.id/fare?to=KCI-MRI&j=C.SUD-MRI"))
    }

    @Test
    fun `a station link opens its page, or its full timetable`() {
        assertEquals(Route.Station("KCI-MRI"), routeForLink("https://commute.shiorilabs.id/stations/KCI/MRI"))
        assertEquals(Route.Station("KCI-MRI"), routeForLink("https://commute.shiorilabs.id/stations/KCI/MRI/"))
        assertEquals(
            Route.StationTimetable("TJ-H00001P"),
            routeForLink("https://commute.shiorilabs.id/stations/TJ/H00001P/timetable"),
        )
    }

    @Test
    fun `a hand-typed lower-case station link names the canonical id`() {
        assertEquals(Route.Station("KCI-BKST"), routeForLink("https://commute.shiorilabs.id/stations/kci/bkst"))
    }

    @Test
    fun `station links the app has no screen for stay in the browser`() {
        assertNull(routeForLink("https://commute.shiorilabs.id/stations/KCI"))
        assertNull(routeForLink("https://commute.shiorilabs.id/stations/KCI//timetable"))
        assertNull(routeForLink("https://commute.shiorilabs.id/stations/KCI/MRI/exits"))
        assertNull(routeForLink("https://commute.shiorilabs.id/stations/KCI/MRI/timetable/extra"))
    }

    @Test
    fun `a hub link opens its page`() {
        assertEquals(Route.Hub("dukuh-atas"), routeForLink("https://commute.shiorilabs.id/hubs/dukuh-atas"))
        assertEquals(Route.Hub("dukuh-atas"), routeForLink("https://commute.shiorilabs.id/hubs/dukuh-atas/"))
        assertNull(routeForLink("https://commute.shiorilabs.id/hubs/"))
        assertNull(routeForLink("https://commute.shiorilabs.id/hubs/dukuh-atas/extra"))
    }

    @Test
    fun `a line link opens its page, its operator upper-cased and its code as written`() {
        assertEquals(Route.Line("KCI", "B"), routeForLink("https://commute.shiorilabs.id/lines/KCI/B"))
        assertEquals(Route.Line("LRTJBDB", "BK"), routeForLink("https://commute.shiorilabs.id/lines/lrtjbdb/BK/"))
        assertNull(routeForLink("https://commute.shiorilabs.id/lines/KCI"))
        assertNull(routeForLink("https://commute.shiorilabs.id/lines/KCI//"))
        assertNull(routeForLink("https://commute.shiorilabs.id/lines/KCI/B/stations"))
    }

    @Test
    fun `links the app has no screen for stay in the browser`() {
        assertNull(routeForLink("https://commute.shiorilabs.id/map?from=KCI-SUD"))
        assertNull(routeForLink("https://example.com/fare?from=KCI-SUD"))
        assertNull(routeForLink("http://commute.shiorilabs.id/fare"))
        assertNull(routeForLink("not a link"))
    }
}
