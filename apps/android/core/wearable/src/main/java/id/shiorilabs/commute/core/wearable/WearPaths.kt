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

    /** Easter egg: getting off at one of these three interchanges, both reminders buzz SOS instead. */
    private val SOS_STOPS = setOf("manggarai", "tanah abang", "duri")

    /** [PING_BUZZ], or SOS ( ... --- ... ) on the same dot, for a stop that earns it. */
    fun pingBuzz(stop: String): LongArray = if (isSosStop(stop)) sos(dot = 100) else PING_BUZZ

    /** [WAKE_BUZZ], or SOS on the same dot, a word's gap after each round, for a stop that earns it. */
    fun wakeBuzz(stop: String): LongArray = if (isSosStop(stop)) sos(dot = 150) else WAKE_BUZZ

    private fun isSosStop(stop: String): Boolean =
        stop.trim().removePrefix("Stasiun ").lowercase() in SOS_STOPS

    private fun sos(dot: Long): LongArray {
        val timings = mutableListOf(0L)
        "...|---|...".split('|').forEach { letter ->
            letter.forEach { symbol ->
                timings += if (symbol == '.') dot else dot * 3
                timings += dot
            }
            timings[timings.lastIndex] = dot * 3
        }
        timings[timings.lastIndex] = dot * 7
        return timings.toLongArray()
    }

    /** Phone to watch: wake the rider, a message whose payload is the stop to get off at. */
    const val WAKE = "/trip/wake"

    /** Phone to watch: the rider is up (said so on the phone, or got off): the alarm stops. */
    const val WAKE_STOP = "/trip/wake/stop"

    /** Watch to phone: "Udah bangun" on the watch, so the phone needn't join in. */
    const val WAKE_ACK = "/trip/wake/ack"

    /**
     * A saved station's timetables, a data item of [WearStation]'s bytes under this prefix plus the
     * station's id (`/saved/station/KCI-TEB`); gone once it is unsaved. TransJakarta haltes, with no
     * timetable, have none.
     */
    const val SAVED_STATION = "/saved/station/"

    /** Watch to phone: send the saved stations again; the payload is one station's id, or empty for all. */
    const val SAVED_SYNC = "/saved/sync"

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
