package id.shiorilabs.commute.core.wearable

import id.shiorilabs.commute.core.trip.RiderAction

/** Where the phone and the watch meet on the Wearable Data Layer. */
object WearPaths {

    /** The running trip, a data item of [WearTrip]'s bytes; gone when there is none. */
    const val TRIP = "/trip/active"

    /** A tap on the watch, a message whose payload is a [RiderAction]'s name. */
    const val ACTION = "/trip/action"

    /** Declared by the phone app, so the watch can tell it is installed and where to send taps. */
    const val PHONE_CAPABILITY = "commute_phone"

    /** Declared by the watch app. */
    const val WEAR_CAPABILITY = "commute_wear"

    /** What the watch's "Buka di HP" opens: the phone app as it was left. */
    const val PHONE_LINK = "commute://home"

    fun encodeAction(action: RiderAction): ByteArray = action.name.encodeToByteArray()

    /** `null` for a payload this version doesn't know. */
    fun decodeAction(bytes: ByteArray): RiderAction? =
        RiderAction.entries.firstOrNull { it.name == bytes.decodeToString() }
}
