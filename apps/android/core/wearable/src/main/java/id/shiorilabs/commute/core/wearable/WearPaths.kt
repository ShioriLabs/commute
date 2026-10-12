package id.shiorilabs.commute.core.wearable

import id.shiorilabs.commute.core.trip.RiderAction

/** Where the phone and the watch meet on the Wearable Data Layer. */
object WearPaths {

    /** The running trip, a data item of [WearTrip]'s bytes; gone when there is none. */
    const val TRIP = "/trip/active"

    /** A tap on the watch, a message whose payload is a [RiderAction]'s name. */
    const val ACTION = "/trip/action"

    /** Phone to watch: "Ingatkan Aku", three knocks (Morse U). */
    const val PING = "/trip/ping"

    /** Morse U, as a knock: dot, dot, dash, a dot's 100 ms. A waveform's timings, off first. */
    val PING_BUZZ = longArrayOf(0, 100, 100, 100, 100, 300)

    /**
     * One round of the wake alarm: T R N, "turun" without its vowels, in Morse (- .-. -.) on a
     * 150 ms dot, then a word's gap before it comes round again. A waveform's timings, off first.
     */
    val WAKE_BUZZ = longArrayOf(0, 450, 450, 150, 150, 450, 150, 150, 450, 450, 150, 150, 1050)

    /** Phone to watch: wake the rider, a message whose payload is the stop to get off at. */
    const val WAKE = "/trip/wake"

    /** Phone to watch: the rider is up (said so on the phone, or got off): the alarm stops. */
    const val WAKE_STOP = "/trip/wake/stop"

    /** Watch to phone: "Udah bangun" on the watch, so the phone needn't join in. */
    const val WAKE_ACK = "/trip/wake/ack"

    /** Declared by the phone app, so the watch can tell it is installed and where to send taps. */
    const val PHONE_CAPABILITY = "commute_phone"

    /** Declared by the watch app. */
    const val WEAR_CAPABILITY = "commute_wear"

    /** What the watch's "Buka di HP" opens: the phone app as it was left. */
    const val PHONE_LINK = "commute://home"

    /** What the phone opens on the watch as a trip starts: the watch app's trip screen. */
    const val WATCH_LINK = "commute://watch/trip"

    fun encodeAction(action: RiderAction): ByteArray = action.name.encodeToByteArray()

    /** `null` for a payload this version doesn't know. */
    fun decodeAction(bytes: ByteArray): RiderAction? =
        RiderAction.entries.firstOrNull { it.name == bytes.decodeToString() }
}
