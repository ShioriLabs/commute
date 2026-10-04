package id.shiorilabs.commute.core.trip

import id.shiorilabs.commute.core.geo.GeoPoint
import kotlinx.serialization.Serializable
import java.time.Instant

@Serializable
enum class TripPhase {
    /** At (or on the way to) the current ride's boarding stop. After a change, the next ride. */
    WAITING_TO_BOARD,

    /** On the current ride. */
    RIDING,

    /** Off the last ride at the destination. */
    ARRIVED,
}

/** How the trip knows where the rider is. */
@Serializable
enum class PositionSource {
    /** A recent location fix near the route. */
    CONFIRMED,

    /** The timetable: where the vehicle should be by now. */
    ESTIMATED,

    /** Neither: an untimed ride with no recent fix. Nothing is guessed. */
    UNKNOWN,
}

/** How hard the service should look for the rider, as the trip needs it. */
@Serializable
enum class TripLocationMode { PRECISE, BALANCED, OFF }

/**
 * Where a trip stands. Stored whole on every change, so a restarted service resumes from it.
 *
 * Positions are along the current ride, as a stop index plus the fraction of the way to the next:
 * `2.5` is halfway between its third and fourth stops.
 */
@Serializable
data class TripState(
    /** Index into [TripPlan.legs] of the current ride; always a ride. */
    val legIndex: Int,
    val phase: TripPhase,
    /** The furthest point a fix has confirmed. Never moves back: GPS jitter can't undo progress. */
    val confirmedPosition: Double = 0.0,
    /** What the rider is shown: [confirmedPosition] while a fix is recent, the clock's estimate after. */
    val position: Double = 0.0,
    val source: PositionSource,
    /**
     * How late the current ride runs, in seconds, as the last fix found it. A train two minutes late
     * at a station we can see is two minutes late for the rest of the leg.
     */
    val clockOffsetS: Long = 0,
    @Serializable(with = InstantSerializer::class)
    val confirmedAt: Instant? = null,
    /** Keys of the alerts already sent, so each fires once. */
    val firedAlerts: Set<String> = emptySet(),
    val offRouteStrikes: Int = 0,
    val askedStillOnRoute: Boolean = false,
    /** Whether the service can get fixes at all (permission, a provider). */
    val hasLocation: Boolean,
    val locationMode: TripLocationMode,
    @Serializable(with = InstantSerializer::class)
    val startedAt: Instant,
    @Serializable(with = InstantSerializer::class)
    val arrivedAt: Instant? = null,
    /** Picked up again after the service was killed, and nothing has confirmed the position since. */
    val resumed: Boolean = false,
)

sealed interface TripEvent {

    val at: Instant

    /** A location reading. */
    data class Fix(val point: GeoPoint, val accuracyM: Float, override val at: Instant) : TripEvent

    /** Time passing, with nothing else to say. */
    data class Tick(override val at: Instant) : TripEvent

    /** The rider tapped something. */
    data class RiderSaid(val action: RiderAction, override val at: Instant) : TripEvent

    /** Location became available or went away (permission, provider, battery saver). */
    data class LocationAvailability(val available: Boolean, override val at: Instant) : TripEvent

    /** The service came back after being killed, with the stored state. */
    data class Resumed(override val at: Instant) : TripEvent
}

enum class RiderAction { BOARDED, ALIGHTED, STILL_ON_ROUTE, STOP }

enum class AlertKind {
    /** One stop (or about three minutes) before the alighting stop. */
    PREPARE,

    /** At the alighting stop; at a change it also says what to take next. */
    ALIGHT,

    /** A fix past the alighting stop. Only ever from a fix. */
    MISSED,

    /** An untimed ride with no way to place the rider: the one honest notice. */
    NO_REMINDERS,
}

enum class FinishReason { ARRIVED, STOPPED, TIMED_OUT }

sealed interface TripEffect {

    /** Tell the rider now. [estimated] alerts are worded as estimates. */
    data class Alert(val kind: AlertKind, val legIndex: Int, val estimated: Boolean) : TripEffect

    data class SetLocationMode(val mode: TripLocationMode) : TripEffect

    /** Fixes keep landing away from the route: "Masih di rute ini?" */
    data object AskStillOnRoute : TripEffect

    data class Finished(val reason: FinishReason) : TripEffect
}

/**
 * The result of one event: the new state, what to do about it, and when the clock alone would next
 * change something (`null` when only a fix or a tap can).
 */
data class TripStep(
    val state: TripState,
    val effects: List<TripEffect>,
    val nextWakeAt: Instant?,
)
