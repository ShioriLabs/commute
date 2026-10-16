package id.shiorilabs.commute.feature.journey.domain

import java.time.Duration
import java.time.Instant
import kotlin.math.ceil
import kotlin.math.max

/*
 * Choosing a different train on one leg, and what that does to the legs after it. The web's
 * `fare-sheet/leg-departures.ts`, pure so it is testable.
 *
 * The API anchors every leg's `upcomingDepartures` on the journey it timed, so each list is "trains
 * you can make if you caught the train before this one on time". Picking a LATER train on one leg
 * only pushes the legs after it later, and the lists already hold everything they could move to.
 * Nothing here asks the server again.
 *
 * Whether a change can be made is the engine's call: each later ride carries `minChangeS`, the
 * allowance charged into it at the rider's own pace.
 */

/** A body from before `minChangeS` existed still has to resolve: a minute plus the walk at average pace. */
private const val FALLBACK_MIN_CHANGE_S = 60
private const val FALLBACK_WALK_M_PER_S = 1.2

/** Spare time under this, beyond the change itself, makes a connection tight. */
private const val TIGHT_SLACK_S = 2 * 60

/** Past this many options a row of chips stops being scannable; use a ladder. */
const val CHIP_ROW_MAX = 4

/** Why an option cannot be picked: unreachable after the train chosen before it, or nothing onward connects. */
enum class Blocked { MISSED, NO_ONWARD }

data class LegOption(
    val departure: LegDeparture,
    /** `null` when the option can be picked. */
    val blocked: Blocked?,
    val selected: Boolean,
    /** Seconds from getting off this train to boarding the next leg's earliest train that still finishes; `null` on the last timed leg or when nothing connects. */
    val gapToNextS: Long?,
    /** That change leaves less than the tight slack beyond the engine's allowance. */
    val tight: Boolean,
)

data class TimedLeg(
    /** Index into the journey's `legs`. */
    val index: Int,
    val chosen: LegDeparture,
    val options: List<LegOption>,
)

private fun upcomingOf(leg: JourneyLeg?): List<LegDeparture> = (leg as? JourneyLeg.Ride)?.upcomingDepartures.orEmpty()

private fun secondsBetween(from: Instant, to: Instant): Long = Duration.between(from, to).seconds

/** The shortest change into leg [to] from the ride at [from], by the engine's rule. */
private fun minChangeS(legs: List<JourneyLeg>, from: Int, to: Int): Int {
    (legs.getOrNull(to) as? JourneyLeg.Ride)?.minChangeS?.let { return it }
    var walkM = 0
    for (i in from + 1 until to) {
        (legs[i] as? JourneyLeg.Transfer)?.let { walkM += it.distanceM }
    }
    return max(FALLBACK_MIN_CHANGE_S, ceil(walkM / FALLBACK_WALK_M_PER_S).toInt())
}

private fun isTight(gapS: Long, minS: Int) = gapS - minS < TIGHT_SLACK_S

/**
 * Every timed ride leg with its options, resolved against the rider's [picks] (leg index to
 * `tripId`). A pick that can no longer be made, or that no later train connects from, is ignored and
 * the leg falls back to the earliest train that works, so a stale pick never produces a connection
 * that runs backwards in time or a journey that stops halfway.
 *
 * With [notBefore] (the clock), first-leg trains that have already left cannot be chosen: the API
 * answers a "now" ask from the start of its 20-minute slot, so its own train can be minutes gone.
 */
fun resolveTimedLegs(legs: List<JourneyLeg>, picks: Map<Int, String>, notBefore: Instant? = null): List<TimedLeg> =
    resolve(legs, picks, notBefore)
        // Every train of the first leg has left (an answer held past its hour): show the answer as it stands.
        .ifEmpty { if (notBefore != null) resolve(legs, picks, null) else emptyList() }

private fun resolve(legs: List<JourneyLeg>, picks: Map<Int, String>, notBefore: Instant?): List<TimedLeg> {
    val timedIndexes = legs.indices.filter { upcomingOf(legs[it]).isNotEmpty() }

    // Which trains on each leg can still finish the journey, worked back from the last leg.
    val finishing = HashMap<Int, Set<String>>()
    for (position in timedIndexes.indices.reversed()) {
        val index = timedIndexes[position]
        val nextIndex = timedIndexes.getOrNull(position + 1)
        val upcoming = upcomingOf(legs[index])
        if (nextIndex == null) {
            finishing[index] = upcoming.map { it.tripId }.toSet()
            continue
        }
        val change = minChangeS(legs, index, nextIndex)
        val nextFinishing = upcomingOf(legs[nextIndex]).filter { it.tripId in finishing.getValue(nextIndex) }
        finishing[index] = upcoming
            .filter { d -> nextFinishing.any { secondsBetween(d.arrivalAt, it.departureAt) >= change } }
            .map { it.tripId }
            .toSet()
    }

    val resolved = mutableListOf<TimedLeg>()
    var previousIndex = -1
    var previousArrival: Instant? = null

    for ((position, index) in timedIndexes.withIndex()) {
        val upcoming = upcomingOf(legs[index])
        val earliest = previousArrival?.plusSeconds(minChangeS(legs, previousIndex, index).toLong())
        fun blockedOf(d: LegDeparture): Blocked? = when {
            earliest != null && d.departureAt.isBefore(earliest) -> Blocked.MISSED
            // The first train has no earlier ride to follow, but the clock still says it has gone.
            earliest == null && notBefore != null && d.departureAt.isBefore(notBefore) -> Blocked.MISSED
            d.tripId in finishing.getValue(index) -> null
            else -> Blocked.NO_ONWARD
        }

        val chosen = upcoming.firstOrNull { it.tripId == picks[index] && blockedOf(it) == null }
            ?: upcoming.firstOrNull { blockedOf(it) == null }
            // Nothing usable: only on a body without `minChangeS` whose fallback disagrees with the
            // engine. Stop rather than emit a connection that runs backwards.
            ?: break

        val nextIndex = timedIndexes.getOrNull(position + 1)
        val change = if (nextIndex == null) 0 else minChangeS(legs, index, nextIndex)
        val nextUpcoming = if (nextIndex == null) {
            emptyList()
        } else {
            upcomingOf(legs[nextIndex]).filter { it.tripId in finishing.getValue(nextIndex) }
        }
        val options = upcoming.map { d ->
            val nextTrain = nextUpcoming.firstOrNull { secondsBetween(d.arrivalAt, it.departureAt) >= change }
            val gap = nextTrain?.let { secondsBetween(d.arrivalAt, it.departureAt) }
            LegOption(
                departure = d,
                blocked = blockedOf(d),
                selected = d.tripId == chosen.tripId,
                gapToNextS = gap,
                tight = gap != null && isTight(gap, change),
            )
        }

        resolved += TimedLeg(index, chosen, options)
        previousIndex = index
        previousArrival = chosen.arrivalAt
    }
    return resolved
}

/** A change at a point in the timeline: its length and whether it is tight. */
data class Change(val gapS: Long, val tight: Boolean)

/**
 * The change at [index]: from the last timed ride before it to the first one at or after it. `null`
 * when either side is untimed, because a gap with one end unknown is not a number.
 */
fun changeAt(legs: List<JourneyLeg>, timed: List<TimedLeg>, index: Int): Change? {
    val before = timed.lastOrNull { it.index < index }
    val after = timed.firstOrNull { it.index >= index }
    if (before == null || after == null) return null
    val gap = secondsBetween(before.chosen.arrivalAt, after.chosen.departureAt)
    return Change(gap, isTight(gap, minChangeS(legs, before.index, after.index)))
}

/**
 * The journey as the rider's picks have re-timed it, so every surface that reads a journey agrees
 * with the train they chose rather than the one the API caught.
 *
 * A leg whose train changed loses `stopTimes` and `lastService`: both describe the boarded trip, and
 * the upcoming list carries neither for the others. Unchanged, as the same object, when nothing was
 * picked or the picks could not be resolved for every timed leg.
 */
fun retimeJourney(journey: Journey, timed: List<TimedLeg>): Journey {
    val timedCount = journey.legs.count { upcomingOf(it).isNotEmpty() }
    val changed = timed.any { (journey.legs[it.index] as? JourneyLeg.Ride)?.tripId != it.chosen.tripId }
    if (!changed || timed.size != timedCount) return journey

    val byIndex = timed.associate { it.index to it.chosen }
    val legs = journey.legs.mapIndexed { index, leg ->
        val chosen = byIndex[index]
        if (leg !is JourneyLeg.Ride || chosen == null || chosen.tripId == leg.tripId) {
            leg
        } else {
            leg.copy(
                line = chosen.line,
                headsign = chosen.headsign ?: leg.headsign,
                departureAt = chosen.departureAt,
                arrivalAt = chosen.arrivalAt,
                tripId = chosen.tripId,
                stopTimes = emptyList(),
                lastService = false,
            )
        }
    }
    // `moreDepartures` is dropped: it is relative to the train the API caught, so after a pick it
    // would name the chosen train as a "later" one. The chips on each leg are the authority now.
    return journey.copy(
        legs = legs,
        arrivalAt = if (journey.arrivalAt != null) timed.last().chosen.arrivalAt else null,
        moreDepartures = emptyList(),
    )
}

/** How near the first train is, for the countdown above the timeline. */
sealed interface LeaveIn {
    data object Gone : LeaveIn

    data object Now : LeaveIn

    data class InMinutes(val minutes: Int) : LeaveIn
}

/** The countdown to [departureAt], or `null` when it is more than an hour away and the clock alone says it better. */
fun leaveInOf(departureAt: Instant, now: Instant): LeaveIn? {
    val minutes = Math.floorDiv(Duration.between(now, departureAt).toMillis(), 60_000L)
    return when {
        minutes < -1 -> LeaveIn.Gone
        minutes <= 0 -> LeaveIn.Now
        minutes < 60 -> LeaveIn.InMinutes(minutes.toInt())
        else -> null
    }
}
