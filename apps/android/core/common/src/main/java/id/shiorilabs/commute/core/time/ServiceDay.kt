package id.shiorilabs.commute.core.time

import id.shiorilabs.commute.core.constants.HOLIDAYS
import java.time.DayOfWeek
import java.time.LocalDateTime
import java.time.ZoneId

/*
 * The service day: the night belongs to the day it started on. A port of the web's
 * `utils/service-day.ts`; keep the two in step.
 *
 * Timetables store a 00:34 departure as 00:34, not 24:34, so anything that sorts or buckets by the
 * clock alone puts Friday night's last train at the start of Saturday. Everything here reorders by
 * where a departure falls in the SERVICE day instead.
 *
 * Minutes are minutes since local midnight, the unit timetables come in.
 */

/** Jakarta, whose clock every timetable is written in. */
val JAKARTA: ZoneId = ZoneId.of("Asia/Jakarta")

private const val DAY_MINUTES = 1440

/**
 * When the night hands over to the next service day.
 *
 * 03:00 sits between the latest last train (KCI Bogor line, 01:07) and the earliest first one (KCI
 * Rangkasbitung line, 03:47), so no departure is ever read as belonging to the wrong day. Only used
 * to pick which day's BOARD to fetch; ordering within a line uses that line's own overnight gap.
 */
private const val ROLLOVER_HOUR = 3

/** A timetable's day, as the API's `?day=` names it. */
enum class ServiceDayName { WD, SAT, SUN }

/**
 * Which day's timetable is running at [now] (Jakarta wall-clock time).
 *
 * The API resolves an absent `day` by calendar date, which at 00:30 on a Saturday serves the SAT
 * board while Friday night's trains are still running off the WD one. Asking for the service day
 * explicitly closes that gap. Holidays run a Sunday service, as in the API's own `serviceDay`.
 */
fun serviceDayOf(now: LocalDateTime): ServiceDayName {
    val day = now.minusHours(ROLLOVER_HOUR.toLong()).toLocalDate()
    return when {
        day.toString() in HOLIDAYS -> ServiceDayName.SUN
        day.dayOfWeek == DayOfWeek.SUNDAY -> ServiceDayName.SUN
        day.dayOfWeek == DayOfWeek.SATURDAY -> ServiceDayName.SAT
        else -> ServiceDayName.WD
    }
}

/**
 * The service day after the one running at [now], whose board holds tomorrow's first trains. A day
 * later on the clock is always the next service day, since both sides of the shift sit the same
 * distance from the rollover.
 */
fun nextServiceDayOf(now: LocalDateTime): ServiceDayName = serviceDayOf(now.plusDays(1))

/**
 * The minute a line's service day starts, or null when it never stops.
 *
 * The start is the departure after the largest circular gap. Neither min/max nor a fixed cutoff
 * works — KCI lines have departures at both 00:00 and 23:59 — while the overnight break is
 * unmistakable, hours long against a daytime gap of minutes.
 *
 * Take it over a whole LINE, not one destination. A peak-only short-turn has a midday gap longer
 * than its night, and would put its "service start" at 16:00.
 */
fun serviceStartMinute(minutes: Collection<Int>, minGapMinutes: Int = 90): Int? {
    val times = minutes.toSortedSet().toList()
    if (times.size < 2) {
        return null
    }
    var largest = -1
    var lastBeforeGap = -1
    for (i in times.indices) {
        val gap = (times[(i + 1) % times.size] - times[i] + DAY_MINUTES) % DAY_MINUTES
        if (gap > largest) {
            largest = gap
            lastBeforeGap = i
        }
    }
    if (largest < minGapMinutes) {
        return null
    }
    return times[(lastBeforeGap + 1) % times.size]
}

/** Minutes into the service day starting at [start]. The sort key for "later tonight". */
fun servicePosition(minute: Int, start: Int): Int = ((minute - start) % DAY_MINUTES + DAY_MINUTES) % DAY_MINUTES

/** The last [n] of [items] in the service day, earliest first. */
fun <T> lastDepartures(items: List<T>, start: Int, n: Int = 3, minuteOf: (T) -> Int): List<T> =
    items.sortedBy { servicePosition(minuteOf(it), start) }.takeLast(n)

/** The first of [items] in the service day. */
fun <T> firstDeparture(items: List<T>, start: Int, minuteOf: (T) -> Int): T? =
    items.minByOrNull { servicePosition(minuteOf(it), start) }

/**
 * Is the rider waiting for TODAY's first departure rather than tomorrow's?
 *
 * Both sit in the same dead zone as far as [isServiceOver] is concerned, but at 04.10 before a
 * 04.24 start the service day has already turned over, so the restart is on the board already
 * fetched. At 01.30 it has not, and the restart is on the next day's board.
 */
fun restartsToday(nowMinute: Int, start: Int): Boolean = nowMinute >= ROLLOVER_HOUR * 60 && nowMinute < start

/**
 * Has the last departure gone? True from the minute after it until the line's next start, which is
 * the whole overnight dead zone.
 */
fun isServiceOver(nowMinute: Int, lastMinute: Int, start: Int): Boolean =
    servicePosition(nowMinute, start) > servicePosition(lastMinute, start)

/** Minutes since local midnight. */
fun minuteOfDay(time: LocalDateTime): Int = time.hour * 60 + time.minute
