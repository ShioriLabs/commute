package id.shiorilabs.commute.feature.trip.runtime

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Duration

class ReminderTuneTest {

    @Test
    fun `a rider asleep is woken gently at first`() {
        assertEquals(0.1f, wakeVolume(Duration.ZERO), 0.001f)
    }

    @Test
    fun `the tune only ever gets louder`() {
        val volumes = (0..RAMP.seconds).map { wakeVolume(Duration.ofSeconds(it)) }

        assertTrue(volumes.zipWithNext().all { (before, after) -> after > before })
    }

    @Test
    fun `halfway up it's still well short of full, as loudness is heard`() {
        assertEquals(0.316f, wakeVolume(RAMP.dividedBy(2)), 0.001f)
    }

    @Test
    fun `it stays at full once the ramp is done`() {
        assertEquals(1f, wakeVolume(RAMP), 0f)
        assertEquals(1f, wakeVolume(RAMP.multipliedBy(4)), 0f)
    }
}
