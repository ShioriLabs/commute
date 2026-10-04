package id.shiorilabs.commute.feature.trip.presentation

import id.shiorilabs.commute.core.trip.PositionSource
import id.shiorilabs.commute.core.trip.TripLeg
import id.shiorilabs.commute.core.trip.TripPhase
import id.shiorilabs.commute.core.trip.expectedAtStop
import id.shiorilabs.commute.feature.trip.ActiveTrip
import java.time.Instant
import kotlin.math.floor

/** What the board's small line over the big name says. */
enum class PidsLabel {
    /** Waiting to board: "Naik di". */
    BOARD,

    /** "Berikutnya". */
    NEXT,

    /** The next stop is the one to get off at: "Berikutnya, turun di". */
    ALIGHT_NEXT,

    /** At the alighting stop: "Turun di sini". */
    ALIGHT_HERE,

    /** "Udah sampai". */
    ARRIVED,
}

/** One stop on the board's band, nearest first. */
data class PidsStop(
    val name: String,
    /** Whole minutes away, when the timetable or a fix can say; `null` leaves the bubble blank. */
    val minutes: Int?,
    /** The stop the big name is about, drawn highlighted. */
    val next: Boolean,
    val alighting: Boolean,
)

/**
 * The in-train display for the ride being followed, after JR East's: the next station in big type
 * over a band of the stops ahead, each with how many minutes away it is.
 *
 * @property station The big name.
 * @property at When the ride should be there, lateness included.
 * @property stationId The big name's station, for the lines a rider can change to there.
 * @property changeTo The ride the plan changes onto at [station], when it is where the rider gets
 *   off and another ride follows.
 */
data class Pids(
    val ride: TripLeg.Ride,
    val label: PidsLabel,
    val station: String,
    val stationId: String,
    val at: Instant?,
    val upcoming: List<PidsStop>,
    val changeTo: TripLeg.Ride?,
)

/** Stops ahead on the band: as many as a phone's height reads at a glance. */
const val PIDS_STOPS = 5

internal fun ActiveTrip.pids(now: Instant): Pids {
    val ride = plan.ride(state.legIndex)
    val last = ride.lastIndex
    val then = plan.nextRideAfter(state.legIndex)?.let(plan::ride)
    val placeable = state.source != PositionSource.UNKNOWN
    fun minutesTo(index: Int) = state.expectedAtStop(plan, index)?.takeIf { placeable }?.let { minutesUntil(now, it) }

    if (state.phase == TripPhase.ARRIVED) {
        val stop = ride.stops.last()
        return Pids(ride, PidsLabel.ARRIVED, stop.name, stop.id, null, emptyList(), null)
    }

    val (label, focus) = when {
        state.phase == TripPhase.WAITING_TO_BOARD -> PidsLabel.BOARD to 0
        state.position >= last -> PidsLabel.ALIGHT_HERE to last
        else -> {
            val next = (floor(state.position).toInt() + 1).coerceAtMost(last)
            (if (next == last) PidsLabel.ALIGHT_NEXT else PidsLabel.NEXT) to next
        }
    }
    val upcoming = (focus..minOf(last, focus + PIDS_STOPS - 1)).map { index ->
        PidsStop(
            name = ride.stops[index].name,
            minutes = if (label == PidsLabel.ALIGHT_HERE) null else minutesTo(index),
            next = index == focus,
            alighting = index == last,
        )
    }
    val stop = ride.stops[focus]
    return Pids(
        ride = ride,
        label = label,
        station = stop.name,
        stationId = stop.id,
        at = state.expectedAtStop(plan, focus),
        upcoming = upcoming,
        changeTo = then?.takeIf { focus == last },
    )
}
