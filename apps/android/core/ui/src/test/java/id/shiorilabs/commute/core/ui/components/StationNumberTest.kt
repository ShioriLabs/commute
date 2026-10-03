package id.shiorilabs.commute.core.ui.components

import org.junit.Assert.assertEquals
import org.junit.Test

class StationNumberTest {

    @Test
    fun `a station number splits into its prefix and position`() {
        assertEquals("C" to "13", splitStationNumber("C13"))
        assertEquals("TP" to "01", splitStationNumber("TP01"))
        assertEquals("C" to "11a", splitStationNumber("C11a"))
        assertEquals("13" to "4", splitStationNumber("13-4"))
        assertEquals("" to "12", splitStationNumber("12"))
        assertEquals("" to "BST", splitStationNumber("BST"))
    }
}
