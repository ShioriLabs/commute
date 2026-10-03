package id.shiorilabs.commute.core.navigation

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class DeepLinksTest {

    @Test
    fun `a shared fare link opens OTW with everything it carries`() {
        val route = routeForLink(
            "https://commute.shiorilabs.id/fare?from=KCI-SUD&to=MRTJ-LBB&paymentMethod=QRIS_TAP" +
                "&at=2026-10-05T03%3A20%3A00Z&modes=rail&walking=SLOW&j=C.SUD-MRI%7E_DKA",
        )

        assertEquals(
            Route.Journey(
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
    fun `a station's OTW link carries only the destination`() {
        assertEquals(Route.Journey(toId = "KCI-MRI"), routeForLink("https://commute.shiorilabs.id/fare?to=KCI-MRI"))
        assertEquals(Route.Journey(), routeForLink("https://commute.shiorilabs.id/fare/"))
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
    fun `links the app has no screen for stay in the browser`() {
        assertNull(routeForLink("https://commute.shiorilabs.id/map?from=KCI-SUD"))
        assertNull(routeForLink("https://example.com/fare?from=KCI-SUD"))
        assertNull(routeForLink("http://commute.shiorilabs.id/fare"))
        assertNull(routeForLink("not a link"))
    }
}
