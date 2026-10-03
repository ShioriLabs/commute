package id.shiorilabs.commute.feature.station.presentation

import id.shiorilabs.commute.feature.station.R
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class StationNoticesTest {

    @Test
    fun `Gambir is unserved, whatever the case of its id`() {
        assertEquals(R.string.station_unserved_gambir_title, unservedStation("KCI-GMR")?.title)
        assertEquals(unservedStation("KCI-GMR"), unservedStation("kci-gmr"))
    }

    @Test
    fun `Karet is retired, and points at BNI City`() {
        assertEquals("KCI-SUDB", retiredStation("KCI-KAT")?.redirect?.stationId)
        assertEquals(retiredStation("KCI-KAT"), retiredStation("kci-Kat"))
    }

    @Test
    fun `an ordinary station has no notice`() {
        assertNull(unservedStation("KCI-MRI"))
        assertNull(retiredStation("KCI-MRI"))
        assertNull(retiredStation("KCI-GMR"))
    }
}
