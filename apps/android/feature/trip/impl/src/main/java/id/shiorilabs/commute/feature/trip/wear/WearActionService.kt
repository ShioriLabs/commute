package id.shiorilabs.commute.feature.trip.wear

import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.WearableListenerService
import dagger.hilt.android.AndroidEntryPoint
import id.shiorilabs.commute.core.trip.RiderAction
import id.shiorilabs.commute.core.wearable.WearPaths
import id.shiorilabs.commute.feature.trip.TripController
import id.shiorilabs.commute.feature.trip.runtime.TripWaker
import javax.inject.Inject

/**
 * The watch's buttons: "Udah naik", "Udah turun", "Masih" and "Berhenti", as the phone's own, and
 * "Udah bangun" on its alarm.
 */
@AndroidEntryPoint
class WearActionService : WearableListenerService() {

    @Inject
    lateinit var controller: TripController

    @Inject
    lateinit var waker: TripWaker

    override fun onMessageReceived(event: MessageEvent) {
        when (event.path) {
            WearPaths.ACTION -> controller.onWearAction(event.data)
            WearPaths.WAKE_ACK -> waker.stop(tellWatch = false)
        }
    }
}

/** Carries out a tap the watch sent; one this version doesn't know does nothing. */
internal fun TripController.onWearAction(payload: ByteArray) {
    when (val action = WearPaths.decodeAction(payload) ?: return) {
        RiderAction.STOP -> stop()
        else -> riderSaid(action)
    }
}
