package id.shiorilabs.commute.feature.trip.runtime

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class TripWakerTest {

    @Test
    fun `a stop out, the tune plays`() {
        assertEquals(ReminderSound.TUNE, reminderSound(alarm = false, atStop = false, tuned = false))
        assertEquals(ReminderSound.TUNE, reminderSound(alarm = true, atStop = false, tuned = false))
    }

    @Test
    fun `at the stop the doors chime, over whatever's left of the tune`() {
        assertEquals(ReminderSound.CHIME, reminderSound(alarm = false, atStop = true, tuned = true))
    }

    @Test
    fun `at the stop an alarm keeps ringing, only louder`() {
        assertEquals(ReminderSound.LOUDEN, reminderSound(alarm = true, atStop = true, tuned = true))
    }

    @Test
    fun `at the stop with no word a stop out, the doors chime alone`() {
        assertEquals(ReminderSound.CHIME, reminderSound(alarm = false, atStop = true, tuned = false))
    }

    @Test
    fun `at the stop with no word a stop out, an alarm starts at full`() {
        assertEquals(ReminderSound.TUNE_AT_FULL, reminderSound(alarm = true, atStop = true, tuned = false))
    }

    @Test
    fun `a stop out said twice plays nothing new`() {
        assertNull(reminderSound(alarm = false, atStop = false, tuned = true))
        assertNull(reminderSound(alarm = true, atStop = false, tuned = true))
    }
}
