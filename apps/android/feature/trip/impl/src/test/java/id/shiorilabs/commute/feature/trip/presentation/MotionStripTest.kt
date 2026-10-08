package id.shiorilabs.commute.feature.trip.presentation

import id.shiorilabs.commute.core.trip.research.MotionReadout
import id.shiorilabs.commute.feature.trip.runtime.MotionLive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class MotionStripTest {

    private val readout = MotionReadout(
        imuSpeedMps = 11.4,
        aLongMps2 = -0.82,
        aligned = true,
        still = false,
        lastGnssSpeedMps = 11.7f,
        lastGnssAtNanos = 10_000_000_000L,
    )

    @Test
    fun `off, there's no strip`() {
        assertNull(motionStrip(enabled = false, live = MotionLive(readout, unavailable = false, nowNanos = 0)))
    }

    @Test
    fun `on but not aboard a train, it says when it runs`() {
        assertEquals(MotionStripState.Waiting, motionStrip(enabled = true, live = null))
    }

    @Test
    fun `without the sensors, it says so`() {
        assertEquals(MotionStripState.Unavailable, motionStrip(enabled = true, live = MotionLive(null, unavailable = true, nowNanos = 0)))
    }

    @Test
    fun `running, both speeds in km per hour and the fix's age in seconds`() {
        val live = MotionLive(readout, unavailable = false, nowNanos = 13_400_000_000L)
        assertEquals(
            MotionStripState.Reading(gpsKmh = 42, gpsAgeS = 3, imuKmh = 41, accelMps2 = -0.82, aligned = true, still = false),
            motionStrip(enabled = true, live = live),
        )
    }

    @Test
    fun `before a fix has said anything, the satellites' side is empty`() {
        val live = MotionLive(readout.copy(lastGnssSpeedMps = null, lastGnssAtNanos = null), unavailable = false, nowNanos = 0)
        val reading = motionStrip(enabled = true, live = live) as MotionStripState.Reading
        assertNull(reading.gpsKmh)
        assertNull(reading.gpsAgeS)
    }
}
