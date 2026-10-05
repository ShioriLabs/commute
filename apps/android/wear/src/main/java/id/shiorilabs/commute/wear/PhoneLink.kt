package id.shiorilabs.commute.wear

import android.content.Context
import android.content.Intent
import androidx.core.net.toUri
import androidx.wear.remote.interactions.RemoteActivityHelper
import com.google.android.gms.wearable.CapabilityClient
import com.google.android.gms.wearable.Node
import com.google.android.gms.wearable.Wearable
import id.shiorilabs.commute.core.trip.RiderAction
import id.shiorilabs.commute.core.wearable.WearPaths
import kotlinx.coroutines.tasks.await

/** The way back to the phone: the rider's taps, and opening the app there. */
class PhoneLink(context: Context) {

    private val app = context.applicationContext

    /** Sends [action] to the phone's trip; `false` when the phone is out of reach. */
    suspend fun send(action: RiderAction): Boolean = runCatching {
        val phone = phone() ?: return false
        Wearable.getMessageClient(app).sendMessage(phone.id, WearPaths.ACTION, WearPaths.encodeAction(action)).await()
        true
    }.getOrDefault(false)

    /** "Udah bangun" on the watch's alarm, so the phone doesn't ring too. */
    suspend fun ackWake() {
        runCatching {
            val phone = phone() ?: return
            Wearable.getMessageClient(app).sendMessage(phone.id, WearPaths.WAKE_ACK, ByteArray(0)).await()
        }
    }

    /** Opens the app on the phone, or its store listing there when it isn't installed. */
    suspend fun openApp() {
        runCatching {
            val phone = phone()
            val link = if (phone != null) WearPaths.PHONE_LINK else "$PLAY_STORE${app.packageName}"
            val intent = Intent(Intent.ACTION_VIEW, link.toUri()).addCategory(Intent.CATEGORY_BROWSABLE)
            RemoteActivityHelper(app).startRemoteActivity(intent, phone?.id)
        }
    }

    /** The phone running the app, the nearest if there are several. */
    private suspend fun phone(): Node? =
        Wearable.getCapabilityClient(app)
            .getCapability(WearPaths.PHONE_CAPABILITY, CapabilityClient.FILTER_REACHABLE)
            .await()
            .nodes
            .minByOrNull { if (it.isNearby) 0 else 1 }

    private companion object {

        const val PLAY_STORE = "market://details?id="
    }
}
