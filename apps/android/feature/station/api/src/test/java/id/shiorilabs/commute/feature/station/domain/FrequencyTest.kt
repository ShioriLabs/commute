package id.shiorilabs.commute.feature.station.domain

import id.shiorilabs.commute.core.time.ServiceDayName.SAT
import id.shiorilabs.commute.core.time.ServiceDayName.SUN
import id.shiorilabs.commute.core.time.ServiceDayName.WD
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Mirrors the web's `components/frequency-card/format.test.ts`. */
class FrequencyTest {

    @Test
    fun `a headway rounds to the nearest whole minute`() {
        assertEquals(7, headwayMinutes(420.0))
        assertEquals(10, headwayMinutes(600.0))
        // 2.83 and 2.43 minutes.
        assertEquals(3, headwayMinutes(170.0))
        assertEquals(2, headwayMinutes(146.0))
    }

    @Test
    fun `the clamped floor reads as two minutes, and nothing reads as zero`() {
        assertEquals(2, headwayMinutes(120.0))
        assertEquals(1, headwayMinutes(20.0))
    }

    @Test
    fun `a line that runs all week gets no day label`() {
        assertNull(dayQualifier(setOf(WD, SAT, SUN)))
        // Absent means every day.
        assertNull(dayQualifier(null))
    }

    @Test
    fun `weekday-only and weekend-only are named`() {
        assertEquals(DayQualifier.WEEKDAYS, dayQualifier(setOf(WD)))
        assertEquals(DayQualifier.WEEKEND, dayQualifier(setOf(SAT, SUN)))
    }

    @Test
    fun `a single weekend day stays distinct from the whole weekend`() {
        assertEquals(DayQualifier.SUNDAY, dayQualifier(setOf(SUN)))
        assertEquals(DayQualifier.SATURDAY, dayQualifier(setOf(SAT)))
        assertNotEquals(dayQualifier(setOf(SUN)), dayQualifier(setOf(SAT, SUN)))
    }

    @Test
    fun `operating hours read with a dot`() {
        assertEquals("05.00", dottedTime("05:00"))
        assertEquals("22.00", dottedTime("22:00"))
    }

    @Test
    fun `a halte recognises its operator by id`() {
        assertTrue(isTransJakarta("TJ-H00001P"))
        assertFalse(isTransJakarta("KCI-MRI"))
        assertFalse(isTransJakarta("MRTJ-LBB"))
    }

    @Test
    fun `adjacent rows of one corridor group together, in the API's order`() {
        val rows = listOf(
            Frequency("TJ:13", 186.0, boundFor = "Tegal Mampang"),
            Frequency("TJ:13", 121.0, boundFor = "Puri Beta 1"),
            Frequency("TJ:13E", null, days = setOf(SAT, SUN)),
            Frequency("TJ:L13E", 120.0),
        )

        val corridors = groupByCorridor(rows)

        assertEquals(listOf("TJ:13", "TJ:13E", "TJ:L13E"), corridors.map { it.first().lineKey })
        assertEquals(listOf("Tegal Mampang", "Puri Beta 1"), corridors[0].map { it.boundFor })
        assertEquals(emptyList<List<Frequency>>(), groupByCorridor(emptyList()))
    }
}
