package id.shiorilabs.commute.feature.station.domain

import id.shiorilabs.commute.feature.station.domain.CrowdLevel.LENGANG
import id.shiorilabs.commute.feature.station.domain.CrowdLevel.PADAT
import id.shiorilabs.commute.feature.station.domain.CrowdLevel.SANGAT_PADAT
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Mirrors the web's `components/density-badge/format.test.ts`. */
class CrowdingTest {

    @Test
    fun `a level off either end of the scale is clamped onto it`() {
        assertEquals(LENGANG, CrowdLevel.of(-1))
        assertEquals(PADAT, CrowdLevel.of(2))
        assertEquals(SANGAT_PADAT, CrowdLevel.of(9))
    }

    @Test
    fun `a range is sure only when its ends meet`() {
        assertTrue(CrowdRange(PADAT, PADAT).isSure)
        assertFalse(CrowdRange(PADAT, SANGAT_PADAT).isSure)
    }

    @Test
    fun `the hour asked for is read, and an hour without an estimate is none`() {
        val forecast = CrowdForecast(List(24) { hour -> if (hour == 8) CrowdRange(PADAT, SANGAT_PADAT) else null })

        assertEquals(CrowdRange(PADAT, SANGAT_PADAT), forecast.at(8))
        assertNull(forecast.at(9))
        assertNull(forecast.at(24))
        assertNull(CrowdForecast.NONE.at(8))
    }
}
