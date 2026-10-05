package id.shiorilabs.commute.wear

import com.google.android.gms.wearable.DataEventBuffer
import com.google.android.gms.wearable.WearableListenerService

/** Keeps the trip's Ongoing Activity in step with the phone, whether or not the app is open. */
class TripListenerService : WearableListenerService() {

    override fun onDataChanged(events: DataEventBuffer) {
        val change = events.latestTrip() ?: return
        val trip = change.trip
        if (trip == null || trip.finished != null) TripOngoing.hide(this) else TripOngoing.show(this, trip)
    }
}
