package id.shiorilabs.commute.feature.station.domain

import id.shiorilabs.commute.core.time.firstDeparture
import id.shiorilabs.commute.core.time.isServiceOver
import id.shiorilabs.commute.core.time.lastDepartures
import id.shiorilabs.commute.core.time.minuteOfDay
import id.shiorilabs.commute.core.time.restartsToday
import id.shiorilabs.commute.core.time.serviceStartMinute
import java.time.LocalDateTime
import kotlin.math.roundToInt

/*
 * What a line card shows at a given moment. The logic of the web's LineCard
 * (apps/web/app/components/line-card) and `utils/schedules.ts`, lifted out of the composable so it
 * can be tested; keep it in step with them.
 */

/** How many departures a destination row shows: the lead one and two after it. */
private const val UPCOMING_LIMIT = 3

/**
 * The lead departure stays relative ("12 mnt") up to this many minutes out, so it reads in the same
 * units across a typical headway rather than flipping to a clock time halfway through.
 */
const val RELATIVE_DEPARTURE_WINDOW_MINUTES = 30

/** Close enough for the arriving-now chevrons, as on a KCI platform display. */
const val IMMINENT_DEPARTURE_WINDOW_MINUTES = 3

/** A destination row at the moment the board was built. */
data class UpcomingDestination(
    val boundFor: String,
    val via: String?,
    /**
     * The next departures, soonest first. When [over], the single last departure of the day
     * instead.
     */
    val departures: List<Departure>,
    /** Past the last departure of the service day. */
    val over: Boolean,
    /** When [over], the departure that starts it again, if the board knows it. */
    val restart: Departure?,
)

data class UpcomingGroup(
    val key: String,
    val label: List<String>,
    val platformCode: String?,
    val destinations: List<UpcomingDestination>,
) {

    /**
     * A single-destination group signed only with its terminus: a "menuju X" header over an "X" row
     * is noise, so the header drops its label.
     */
    val labelIsRedundant: Boolean
        get() = destinations.size == 1 && label.size == 1 && label[0] == destinations[0].boundFor

    /** Whether the group gets a header at all. A platform has to surface even under a redundant label. */
    val showHeader: Boolean
        get() = !labelIsRedundant || platformCode != null
}

/**
 * The card's rows for [line] at [now] (Jakarta wall-clock time).
 *
 * Per destination: the next three departures, or, once the last one of the service day has gone,
 * that last one marked [UpcomingDestination.over] with when it starts again. The restart comes from
 * today's board in the small hours before the first train, and from [nextDayLine] (the next service
 * day's board) any other time. Groups and destinations with nothing to show are dropped.
 */
fun upcomingGroups(line: LineTimetable, nextDayLine: LineTimetable?, now: LocalDateTime): List<UpcomingGroup> {
    // Where this line's service day starts, from its overnight gap. Over the whole line on purpose:
    // a peak-only short-turn has a midday gap longer than its night.
    val serviceStart = serviceStartMinute(line.allMinutes())
    val nextStart = nextDayLine?.let { serviceStartMinute(it.allMinutes()) }
    val nowMinute = minuteOfDay(now)

    return line.groups.mapNotNull { group ->
        val destinations = group.destinations.mapNotNull { destination ->
            val last = serviceStart?.let { start ->
                lastDepartures(destination.departures, start, 1) { it.minute }.firstOrNull()
            }
            val over = last != null && serviceStart != null && isServiceOver(nowMinute, last.minute, serviceStart)

            val restart = when {
                !over || serviceStart == null -> null
                restartsToday(nowMinute, serviceStart) -> firstDeparture(destination.departures, serviceStart) { it.minute }
                nextDayLine != null -> {
                    // Matched by group and destination, so a short-turn restarts with its own first
                    // train rather than the full run's.
                    val match = nextDayLine.groups.firstOrNull { it.key == group.key }
                        ?.destinations?.firstOrNull { it.sameRunAs(destination) }
                        ?: nextDayLine.groups.flatMap { it.destinations }.firstOrNull { it.sameRunAs(destination) }
                    match?.let { firstDeparture(it.departures, nextStart ?: serviceStart) { departure -> departure.minute } }
                }
                else -> null
            }

            val departures = if (over) listOfNotNull(last) else nextDepartures(destination.departures, now)
            UpcomingDestination(
                boundFor = destination.boundFor,
                via = destination.via,
                departures = departures,
                over = over,
                restart = restart,
            ).takeIf { departures.isNotEmpty() }
        }

        UpcomingGroup(group.key, group.label, group.platformCode, destinations)
            .takeIf { destinations.isNotEmpty() }
    }
}

private fun LineTimetable.allMinutes(): List<Int> =
    groups.flatMap { group -> group.destinations.flatMap { destination -> destination.departures.map { it.minute } } }

private fun DestinationTimetable.sameRunAs(other: DestinationTimetable) = boundFor == other.boundFor && via == other.via

/**
 * The next [limit] departures at [now], keeping a train that left within the last minute. Falls
 * back to the day's first departure when nothing is left, as the web does.
 *
 * Timetables pin every time to today, so past 21:00 a departure before 04:00 is tonight's late
 * service, not this morning's, and sorts after the evening.
 */
internal fun nextDepartures(departures: List<Departure>, now: LocalDateTime, limit: Int = UPCOMING_LIMIT): List<Departure> {
    val nowSecond = now.toLocalTime().toSecondOfDay()
    val cutoff = nowSecond - 60
    val rollsOver = now.hour >= 21

    fun sortKey(minute: Int) = minute * 60 + if (rollsOver && minute < 4 * 60) 24 * 3600 else 0

    val upcoming = departures
        .filter { sortKey(it.minute) >= cutoff }
        .sortedBy { sortKey(it.minute) }
        .take(limit)

    return upcoming.ifEmpty { departures.take(1) }
}

/** How the lead departure of a row reads. */
sealed interface DepartureLabel {

    /** Within a minute either way: "Sekarang". */
    data object Now : DepartureLabel

    /** "12 mnt". */
    data class InMinutes(val minutes: Int) : DepartureLabel

    /** Outside the relative window: a clock time. */
    data class At(val minute: Int) : DepartureLabel
}

private fun minutesUntil(now: LocalDateTime, minute: Int): Int =
    ((minute * 60 - now.toLocalTime().toSecondOfDay()) / 60.0).roundToInt()

/**
 * The lead departure's label. The -1 lower bound keeps a just-departed train relative, while times
 * pinned to the wrong day (cross-midnight runs, the first-train fallback) fall far below it and
 * stay absolute.
 */
fun departureLabel(now: LocalDateTime, minute: Int): DepartureLabel {
    val minutes = minutesUntil(now, minute)
    return when {
        minutes < -1 || minutes >= RELATIVE_DEPARTURE_WINDOW_MINUTES -> DepartureLabel.At(minute)
        minutes <= 1 -> DepartureLabel.Now
        else -> DepartureLabel.InMinutes(minutes)
    }
}

/**
 * Whether the departure gets the arriving-now chevrons. Two-sided by design: the first-train
 * fallback can hold a time hours in the past, which must never pulse.
 */
fun isImminentDeparture(now: LocalDateTime, minute: Int): Boolean =
    minutesUntil(now, minute) in -1..IMMINENT_DEPARTURE_WINDOW_MINUTES

/** A clock time the way Indonesian signage writes it: `17.52`. */
fun formatClock(minute: Int): String = "%02d.%02d".format((minute / 60) % 24, minute % 60)

/**
 * Middot rather than "/" between station names: a slash reads as "or" and collides with the way
 * stations sign a shared island platform ("1/2").
 */
fun joinLabels(labels: List<String>): String = labels.joinToString(" · ")

/** A platform code for display: stations sign `3/4` on one island as `3·4`. */
fun formatPlatformCode(code: String): String = code.replace(Regex("\\s*/\\s*"), "·")
