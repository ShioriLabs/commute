package id.shiorilabs.commute.feature.trip.runtime

import id.shiorilabs.commute.core.notification.NotificationChannels
import id.shiorilabs.commute.feature.trip.TripReminder
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TripNotifierTest {

    @Test
    fun `with the tune on, "turun" keeps quiet for the doors' chime`() {
        assertEquals(NotificationChannels.TRIP_ALIGHT, alightChannel(tune = true, TripReminder.NONE))
        assertEquals(NotificationChannels.TRIP_ALIGHT, alightChannel(tune = true, TripReminder.PING))
    }

    @Test
    fun `with the tune off, "turun" sounds as any other alert`() {
        assertEquals(NotificationChannels.TRIP_ALERTS, alightChannel(tune = false, TripReminder.NONE))
        assertEquals(NotificationChannels.TRIP_ALERTS, alightChannel(tune = false, TripReminder.PING))
    }

    @Test
    fun `a rider being woken gets the alarm, not the chime`() {
        assertEquals(NotificationChannels.TRIP_ALERTS, alightChannel(tune = true, TripReminder.WAKE))
        assertEquals(NotificationChannels.TRIP_ALERTS, alightChannel(tune = false, TripReminder.WAKE))
    }

    @Test
    fun `the same notification again isn't posted`() {
        val last = LastPosted<String>()
        assertTrue(last.changed("Naik di Cakung"))
        assertFalse(last.changed("Naik di Cakung"))
    }

    @Test
    fun `a notification that reads differently is posted`() {
        val last = LastPosted<String>()
        last.changed("Naik di Cakung")
        assertTrue(last.changed("Turun di Sudirman"))
        assertFalse(last.changed("Turun di Sudirman"))
    }

    @Test
    fun `one put up some other way counts as posted`() {
        val last = LastPosted<String>()
        last.record("Naik di Cakung")
        assertFalse(last.changed("Naik di Cakung"))
    }

    @Test
    fun `once taken down, the same one goes up again`() {
        val last = LastPosted<String>()
        last.changed("Naik di Cakung")
        last.clear()
        assertTrue(last.changed("Naik di Cakung"))
    }
}
