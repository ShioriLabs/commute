package id.shiorilabs.commute.feature.trip.runtime

import android.app.AlarmManager
import android.content.Context
import dagger.hilt.android.qualifiers.ApplicationContext
import java.time.Instant
import javax.inject.Inject
import javax.inject.Singleton

/**
 * The backstop for the trip's clock: an alarm at the next moment the timetable changes something,
 * which fires through Doze and wakes a process the system killed.
 *
 * Inexact on purpose. An exact alarm needs a permission riders are asked to grant by hand, and the
 * moments it backs are estimates already worded as such; Doze can hold this one back a few minutes
 * at worst. While the screen is on, or fixes keep the device awake, the in-process timer fires first.
 */
@Singleton
class TripAlarms @Inject constructor(
    @param:ApplicationContext private val context: Context,
) {

    private val alarms = context.getSystemService(AlarmManager::class.java)

    fun wakeAt(at: Instant) {
        alarms?.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at.toEpochMilli(), tick())
    }

    fun cancel() {
        alarms?.cancel(tick())
    }

    private fun tick() = TripReceiver.pendingIntent(context, TripReceiver.ACTION_TICK)
}
