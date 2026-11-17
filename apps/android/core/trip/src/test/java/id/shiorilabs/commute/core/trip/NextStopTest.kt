package id.shiorilabs.commute.core.trip

import org.junit.Assert.assertEquals
import org.junit.Test

class NextStopTest {

    private val ride = TripLeg.Ride(
        line = "KCI:B",
        operator = "KCI",
        stops = listOf(Places.MANGGARAI, Places.TEBET, Places.CAWANG, Places.DUREN_KALIBATA, Places.PASAR_MINGGU_BARU),
        departureAt = at(10),
        arrivalAt = at(22),
    )

    @Test
    fun `just left the first stop, the second is next`() {
        assertEquals(Places.TEBET, Headline.RideTo(ride, 4, at(22)).nextStop)
    }

    @Test
    fun `midway, the stop after the last one passed`() {
        assertEquals(Places.DUREN_KALIBATA, Headline.RideTo(ride, 2, at(22)).nextStop)
    }

    @Test
    fun `one stop left, the alighting one`() {
        assertEquals(Places.PASAR_MINGGU_BARU, Headline.RideTo(ride, 1, at(22)).nextStop)
    }
}
