package id.shiorilabs.commute.feature.saved.presentation.nearby

import org.junit.Assert.assertEquals
import org.junit.Test

class FormatDistanceTest {

    @Test
    fun `metres round to the nearest ten`() {
        assertEquals("350 m", formatDistance(347))
        assertEquals("350 m", formatDistance(345))
        assertEquals("340 m", formatDistance(344))
    }

    @Test
    fun `past a kilometre it is kilometres the Indonesian way`() {
        assertEquals("1,2 km", formatDistance(1234))
    }

    @Test
    fun `just under a kilometre rounds up into kilometres`() {
        assertEquals("1,0 km", formatDistance(997))
    }
}
