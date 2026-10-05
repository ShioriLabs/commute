package id.shiorilabs.commute.wear

import android.content.Context
import androidx.core.content.edit
import com.google.android.gms.wearable.DataEventBuffer
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.WearableListenerService
import id.shiorilabs.commute.core.wearable.WearPaths
import id.shiorilabs.commute.core.wearable.WearTrip
import java.time.Duration
import java.time.Instant

/**
 * Keeps the trip's Ongoing Activity in step with the phone, whether or not the app is open, buzzes
 * once as a new trip comes in, and buzzes or rings the trip's reminder when the phone says to.
 */
class TripListenerService : WearableListenerService() {

    override fun onMessageReceived(event: MessageEvent) {
        when (event.path) {
            WearPaths.PING -> WatchAlarm.ping(this)
            WearPaths.WAKE -> WatchAlarm.ring(this, event.data.decodeToString())
            WearPaths.WAKE_STOP -> WatchAlarm.silence(this)
        }
    }

    override fun onDataChanged(events: DataEventBuffer) {
        val change = events.latestTrip() ?: return
        val trip = change.trip
        if (trip == null || trip.finished != null) {
            TripOngoing.hide(this)
            return
        }
        TripOngoing.show(this, trip)
        if (isNewlyStarted(trip)) TripOngoing.announceStart(this, trip)
    }

    /**
     * A trip started within the last minute that hasn't been announced: not one already running when
     * the watch came back in range. Remembered on disk, as this service doesn't outlive each change.
     */
    private fun isNewlyStarted(trip: WearTrip): Boolean {
        val startedAt = trip.state.startedAt
        val prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (prefs.getLong(ANNOUNCED, 0) == startedAt.toEpochMilli()) return false
        if (Duration.between(startedAt, Instant.now()) >= ANNOUNCE_WITHIN) return false
        prefs.edit { putLong(ANNOUNCED, startedAt.toEpochMilli()) }
        return true
    }

    private companion object {

        const val PREFS = "trip_listener"
        const val ANNOUNCED = "announced_started_at"
        val ANNOUNCE_WITHIN: Duration = Duration.ofMinutes(1)
    }
}
