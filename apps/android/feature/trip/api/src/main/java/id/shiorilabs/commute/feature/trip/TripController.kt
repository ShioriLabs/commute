package id.shiorilabs.commute.feature.trip

import id.shiorilabs.commute.core.navigation.Route
import id.shiorilabs.commute.core.trip.InstantSerializer
import id.shiorilabs.commute.core.trip.RiderAction
import id.shiorilabs.commute.core.trip.TripPlan
import id.shiorilabs.commute.core.trip.TripState
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.Serializable
import java.time.Instant

/**
 * The trip the rider is following, with where it stands.
 *
 * @property origin The trip page it was started from, so "Lihat perjalanan" there can tell it is this
 *   journey, and the live screen can go back to the details.
 * @property reminder How getting off is told, past the notification: this trip only.
 * @property replaced The plan as it was before a ride was last swapped for a later one, until the
 *   rider boards: the train it was swapped from may only have run late, and the rider be on it.
 */
@Serializable
data class ActiveTrip(
    val plan: TripPlan,
    val state: TripState,
    val origin: Route.Trip,
    val reminder: TripReminder = TripReminder.NONE,
    val replaced: ReplacedPlan? = null,
)

/**
 * [plan] before ride [legIndex] was swapped for a later one.
 *
 * @property untold The departure of the first train swapped away while the rider rode on, far
 *   enough out to not be told yet; `null` once told, or for a swap that's never told.
 */
@Serializable
data class ReplacedPlan(
    val plan: TripPlan,
    val legIndex: Int,
    @Serializable(with = InstantSerializer::class)
    val untold: Instant? = null,
)

/** "Tambah Pengingat": what the rider asked to be told as getting off comes up. */
@Serializable
enum class TripReminder {
    /** The notification alone. */
    NONE,

    /**
     * "Ingatkan Aku": one hard buzz with "Siap-siap turun", on the watch if one's in reach, else the
     * phone, as an alarm's buzz, so it comes through silent mode.
     */
    PING,

    /**
     * "Bangunkan Aku", for a rider who means to sleep: an alarm until they say they're up, on the
     * watch, and the phone too if the watch goes unanswered.
     */
    WAKE,
}

/**
 * Trip mode, for the screens that start and show it. One trip at a time: starting another replaces
 * the one running.
 */
interface TripController {

    /** The running trip, or `null`; read back from storage when the app starts. */
    val active: StateFlow<ActiveTrip?>

    /**
     * Follows [plan] from now. Location is used if it is granted at this moment, the clock alone
     * otherwise; the trip says which.
     */
    fun start(plan: TripPlan, origin: Route.Trip)

    /** "Tambah Pengingat" on the running trip, or [TripReminder.NONE] to take it off. */
    fun setReminder(reminder: TripReminder)

    /** "Udah naik", "Udah turun", "Masih di rute ini". */
    fun riderSaid(action: RiderAction)

    fun stop()
}
