package id.shiorilabs.commute.feature.trip.runtime

import id.shiorilabs.commute.core.notification.NotificationChannels
import id.shiorilabs.commute.feature.trip.TripReminder
import org.junit.Assert.assertEquals
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
}
