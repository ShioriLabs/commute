package id.shiorilabs.commute.feature.trip.presentation

import id.shiorilabs.commute.core.trip.PositionSource
import id.shiorilabs.commute.core.trip.minutesUntil
import id.shiorilabs.commute.core.trip.TripLeg
import id.shiorilabs.commute.core.trip.TripPhase
import id.shiorilabs.commute.core.trip.expectedAt
import id.shiorilabs.commute.core.trip.expectedAtStop
import id.shiorilabs.commute.feature.trip.ActiveTrip
import id.shiorilabs.commute.core.trip.scheduledAtStop
import id.shiorilabs.commute.core.trip.walkEndsAt
import java.time.Duration
import java.time.Instant
import kotlin.math.floor

/** What the board's small line over the big name says. */
enum class PidsLabel {
    /** Off one ride, walking to the station the next leaves from: "Jalan kaki ke". */
    WALK,

    /** Waiting to board: "Naik di". */
    BOARD,

    /** Stopped at a station on the way, by a fix: "Sekarang di", until the train moves off. */
    AT,

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
 * @property changeWalk The walk to where [changeTo] leaves from, when that's another station.
 * @property stopsLeft Stops still to come before getting off, the alighting stop counted: the whole
 *   ride while waiting to board, `0` once arrived.
 * @property minutesLeft Whole minutes until getting off, wait for the train included, when the
 *   timetable or a fix can say; `null` there and once arrived.
 * @property alightingAt When the ride should reach the stop to get off at, lateness included.
 * @property walkM The walk to [station], while [label] is [PidsLabel.WALK].
 * @property walkMinutes About how much of that walk is left, in whole minutes.
 */
data class Pids(
    val ride: TripLeg.Ride,
    val label: PidsLabel,
    val station: String,
    val stationId: String,
    val at: Instant?,
    val upcoming: List<PidsStop>,
    val changeTo: TripLeg.Ride?,
    val changeWalk: TripLeg.Transfer? = null,
    val stopsLeft: Int,
    val minutesLeft: Int?,
    val alightingAt: Instant?,
    val walkM: Int? = null,
    val walkMinutes: Int? = null,
    /** When the timetable has the ride reaching the stop to get off at, to set [alightingAt] against. */
    val alightingScheduled: Instant? = null,
)


/** Stops ahead on the band: as many as a phone's height reads at a glance. */
const val PIDS_STOPS = 4

/**
 * How late the ride being followed runs at [now], past what the trip already knows. The train can't
 * be anywhere the rider isn't: if the timetable says it passed where they are already, it runs that
 * late for every stop ahead. A train waited for on the platform after its time, too.
 */
internal fun ActiveTrip.slip(now: Instant): Duration = state.expectedAt(plan, state.position)
    ?.let { Duration.between(it, now) }
    ?.takeIf { !it.isNegative }
    ?: Duration.ZERO

/**
 * When the trip should be at stop [stopIndex] of leg [legIndex]: on the ride being followed, the
 * board's own reckoning, lateness included; on any other, its timetable. `null` untimed.
 */
internal fun ActiveTrip.expectedAtStop(legIndex: Int, stopIndex: Int, now: Instant): Instant? =
    if (legIndex == state.legIndex && state.phase != TripPhase.ARRIVED) {
        state.expectedAtStop(plan, stopIndex)?.plus(slip(now))
    } else {
        plan.scheduledAtStop(legIndex, stopIndex)
    }

internal fun ActiveTrip.pids(now: Instant): Pids {
    val ride = plan.ride(state.legIndex)
    val last = ride.lastIndex
    val then = plan.nextRideAfter(state.legIndex)?.let(plan::ride)
    val placeable = state.source != PositionSource.UNKNOWN
    val slip = slip(now)
    fun expected(index: Int) = state.expectedAtStop(plan, index)?.plus(slip)
    fun minutesTo(index: Int) = expected(index)?.takeIf { placeable }?.let { minutesUntil(now, it) }

    if (state.phase == TripPhase.ARRIVED) {
        val stop = ride.stops.last()
        return Pids(ride, PidsLabel.ARRIVED, stop.name, stop.id, null, emptyList(), null, stopsLeft = 0, minutesLeft = null, alightingAt = null)
    }

    // A fix places the rider at a stop exactly, and holds there until one finds the train moving;
    // the clock only ever passes through.
    val stopped = state.source == PositionSource.CONFIRMED && state.position == floor(state.position)
    // Walking to the next station: till a fix finds the rider there, or the walk should be done.
    val walkEnds = state.walkEndsAt(plan)?.takeIf { now.isBefore(it) }
    val walk = walkEnds?.let { plan.transferBefore(state.legIndex) }
    val (label, focus) = when {
        walk != null -> PidsLabel.WALK to 0
        state.phase == TripPhase.WAITING_TO_BOARD -> PidsLabel.BOARD to 0
        state.position >= last -> PidsLabel.ALIGHT_HERE to last
        stopped -> PidsLabel.AT to state.position.toInt()
        else -> {
            val next = (floor(state.position).toInt() + 1).coerceAtMost(last)
            (if (next == last) PidsLabel.ALIGHT_NEXT else PidsLabel.NEXT) to next
        }
    }
    val upcoming = (focus..minOf(last, focus + PIDS_STOPS - 1)).map { index ->
        PidsStop(
            name = ride.stops[index].name,
            minutes = if (label == PidsLabel.ALIGHT_HERE || (label == PidsLabel.AT && index == focus)) null else minutesTo(index),
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
        at = expected(focus),
        upcoming = upcoming,
        changeTo = then?.takeIf { focus == last },
        changeWalk = plan.nextRideAfter(state.legIndex)?.let(plan::transferBefore)?.takeIf { focus == last },
        // Boarding or stopped, the stop stood at isn't one still to come.
        stopsLeft = if (label == PidsLabel.WALK || label == PidsLabel.BOARD || label == PidsLabel.AT) last - focus else last - focus + 1,
        minutesLeft = if (label == PidsLabel.ALIGHT_HERE) null else minutesTo(last),
        alightingAt = expected(last),
        walkM = walk?.distanceM,
        walkMinutes = walkEnds?.let { minutesUntil(now, it) },
        alightingScheduled = plan.scheduledAtStop(state.legIndex, last),
    )
}
