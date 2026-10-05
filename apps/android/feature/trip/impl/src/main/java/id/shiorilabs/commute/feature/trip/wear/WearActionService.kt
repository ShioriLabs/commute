package id.shiorilabs.commute.feature.trip.wear

import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.WearableListenerService
import dagger.hilt.android.AndroidEntryPoint
import id.shiorilabs.commute.core.trip.RiderAction
import id.shiorilabs.commute.core.wearable.WearPaths
import id.shiorilabs.commute.feature.trip.TripController
import javax.inject.Inject

/** The watch's buttons: "Udah naik", "Udah turun", "Masih" and "Berhenti", as the phone's own. */
@AndroidEntryPoint
class WearActionService : WearableListenerService() {

    @Inject
    lateinit var controller: TripController

    override fun onMessageReceived(event: MessageEvent) {
        if (event.path == WearPaths.ACTION) controller.onWearAction(event.data)
    }
}

/** Carries out a tap the watch sent; one this version doesn't know does nothing. */
internal fun TripController.onWearAction(payload: ByteArray) {
    when (val action = WearPaths.decodeAction(payload) ?: return) {
        RiderAction.STOP -> stop()
        else -> riderSaid(action)
    }
}
