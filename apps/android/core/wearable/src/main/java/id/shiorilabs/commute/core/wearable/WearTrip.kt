package id.shiorilabs.commute.core.wearable

import id.shiorilabs.commute.core.trip.FinishReason
import id.shiorilabs.commute.core.trip.TripPlan
import id.shiorilabs.commute.core.trip.TripState
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * The phone's running trip as the watch gets it: the plan and where it stands, with the names and
 * colours of its lines, so the watch needs no station data of its own. The engine runs on the phone
 * only; the watch draws this and counts the minutes down on its own clock.
 *
 * @property finished Set once the trip has ended at its destination, for the watch's last word on it.
 */
@Serializable
data class WearTrip(
    val plan: TripPlan,
    val state: TripState,
    val lines: Map<String, WearLine> = emptyMap(),
    val finished: FinishReason? = null,
) {

    fun encode(): ByteArray = JSON.encodeToString(serializer(), this).encodeToByteArray()

    companion object {

        private val JSON = Json { ignoreUnknownKeys = true }

        /** `null` for bytes from an app version whose trip no longer decodes. */
        fun decode(bytes: ByteArray): WearTrip? = runCatching {
            JSON.decodeFromString(serializer(), bytes.decodeToString())
        }.getOrNull()
    }
}

/** A line as the trip names it: `name` as riders know it, `color` as ARGB. */
@Serializable
data class WearLine(val name: String, val color: Int)
