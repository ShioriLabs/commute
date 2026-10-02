package id.shiorilabs.commute.feature.station.presentation.timetable

import id.shiorilabs.commute.core.time.restartsToday
import id.shiorilabs.commute.core.time.serviceStartMinute
import id.shiorilabs.commute.core.time.servicePosition
import id.shiorilabs.commute.feature.station.domain.LineTimetable

/** One departure in the full timetable. */
data class TimetableRow(
    val tripNumber: String?,
    val boundFor: String,
    val via: String?,
    /** Minutes since midnight. */
    val minute: Int,
)

/** One line's departures in one direction: a section of the full timetable under its own header. */
data class TimetableSection(
    /** Stable across fetches: the line and its direction group. */
    val key: String,
    /** `OPERATOR:CODE`. */
    val lineKey: String,
    /** The stations the direction is signed with. */
    val label: List<String>,
    val platformCode: String?,
    /** Every departure of the day in service-day order, so tonight's after-midnight trains come last. */
    val rows: List<TimetableRow>,
    /** The line's service start, for placing "now" among [rows]. Null when the line never stops. */
    val serviceStart: Int?,
)

/**
 * The full timetable as the web's `TimetableContent` lays it out: a section per line and direction,
 * every departure in it, in order.
 *
 * Ordered by where each departure falls in its line's service day rather than the web's "after 21:00,
 * push 00:00-04:00 to tomorrow": the same result late at night, and right at any other hour too. A
 * line that never stops has no service start and is ordered by the clock.
 */
fun timetableSections(timetable: List<LineTimetable>): List<TimetableSection> = timetable.flatMap { line ->
    val start = serviceStartMinute(
        line.groups.flatMap { group -> group.destinations.flatMap { destination -> destination.departures.map { it.minute } } },
    )
    line.groups.map { group ->
        val rows = group.destinations.flatMap { destination ->
            destination.departures.map { TimetableRow(it.tripNumber, destination.boundFor, destination.via, it.minute) }
        }
        TimetableSection(
            key = "${line.lineKey}:${group.key}",
            lineKey = line.lineKey,
            label = group.label,
            platformCode = group.platformCode,
            rows = if (start == null) rows.sortedBy { it.minute } else rows.sortedBy { servicePosition(it.minute, start) },
            serviceStart = start,
        )
    }
}

/**
 * The row of the next departure in [section] at [nowMinute], counting one that left within the last
 * minute as still next, as the web does. -1 once the day's service in that direction is over.
 *
 * Between the 03:00 rollover and the line's first train the board is already today's, and its first
 * departure is the next one, though "now" sits at the very end of the service day.
 */
fun nearestIndex(section: TimetableSection, nowMinute: Int): Int {
    val cutoff = nowMinute - 1
    val start = section.serviceStart
    if (start == null) {
        return section.rows.indexOfFirst { it.minute >= cutoff }
    }
    if (restartsToday(nowMinute, start)) {
        return if (section.rows.isEmpty()) -1 else 0
    }
    val cutoffPosition = servicePosition(cutoff, start)
    return section.rows.indexOfFirst { servicePosition(it.minute, start) >= cutoffPosition }
}
