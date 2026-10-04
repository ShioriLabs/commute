package id.shiorilabs.commute.feature.trip

import id.shiorilabs.commute.core.navigation.Route
import id.shiorilabs.commute.core.trip.RiderAction
import id.shiorilabs.commute.core.trip.TripPlan
import id.shiorilabs.commute.core.trip.TripState
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.Serializable

/**
 * The trip the rider is following, with where it stands.
 *
 * @property origin The trip page it was started from, so "Lihat perjalanan" there can tell it is this
 *   journey, and the live screen can go back to the details.
 */
@Serializable
data class ActiveTrip(
    val plan: TripPlan,
    val state: TripState,
    val origin: Route.Trip,
)

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

    /** "Udah naik", "Udah turun", "Masih di rute ini". */
    fun riderSaid(action: RiderAction)

    fun stop()
}
