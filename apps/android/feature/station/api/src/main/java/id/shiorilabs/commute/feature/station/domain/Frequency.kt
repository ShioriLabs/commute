package id.shiorilabs.commute.feature.station.domain

import id.shiorilabs.commute.core.time.ServiceDayName
import kotlin.math.roundToInt

/*
 * How often a corridor passes a halte. TransJakarta publishes no timetable, so this is the honest
 * floor under one: a frequency, never an arrival. Ports of the web's `components/frequency-card`;
 * keep them in step.
 */

/** TransJakarta's operator code, the one operator that publishes no timetable. */
const val OPERATOR_TJ = "TJ"

/** Whether [stationId] (`TJ-H00001`) is a TransJakarta halte. */
fun isTransJakarta(stationId: String): Boolean = stationId.substringBefore('-') == OPERATOR_TJ

/** One line's frequency at a station, for one direction or for both. */
data class Frequency(
    /** `OPERATOR:CODE`. */
    val lineKey: String,
    /** The average gap between vehicles, or null when the line doesn't run on the day asked about. */
    val headwaySeconds: Double?,
    /**
     * The terminus this direction heads for, as the halte's own board words it ("arah Galunggung").
     * Only there when the two directions differ; null means the figure holds both ways.
     */
    val boundFor: String? = null,
    /** The days the line runs. Null means every day. */
    val days: Set<ServiceDayName>? = null,
    /** The whole line's operating hours, not when it passes here. Null means unknown, not 24 hours. */
    val serviceHours: ServiceHours? = null,
)

sealed interface ServiceHours {
    /** `HH:MM`, Jakarta time; [end] can be before [start] when the line runs past midnight. */
    data class Window(val start: String, val end: String) : ServiceHours

    data object AllDay : ServiceHours
}

/** `05:00` as a rider reads it, `05.00`. */
fun dottedTime(hhmm: String): String = hhmm.replace(':', '.')

/** The exceptions to "every day" worth naming. */
enum class DayQualifier { WEEKDAYS, WEEKEND, SATURDAY, SUNDAY }

/**
 * Seconds as the whole minutes a rider reads, never under one. The figures are averages clamped at a
 * two-minute floor, so the copy carries a tilde rather than claiming this precision.
 */
fun headwayMinutes(seconds: Double): Int = maxOf(1, (seconds / 60).roundToInt())

/**
 * Which days a line runs, as a rider would say it, or null for every day. Most corridors run all
 * week, and labelling them all would bury the few that differ.
 *
 * Sunday-only is its own answer rather than [DayQualifier.WEEKEND]: two corridors really do run on
 * Sundays and not Saturdays, and "akhir pekan" would send a Saturday rider to a halte for a bus
 * that isn't coming.
 */
fun dayQualifier(days: Set<ServiceDayName>?): DayQualifier? {
    if (days == null || days.size == ServiceDayName.entries.size) {
        return null
    }
    val weekend = ServiceDayName.SAT in days && ServiceDayName.SUN in days
    return when {
        ServiceDayName.WD in days -> if (weekend) null else DayQualifier.WEEKDAYS
        weekend -> DayQualifier.WEEKEND
        ServiceDayName.SAT in days -> DayQualifier.SATURDAY
        ServiceDayName.SUN in days -> DayQualifier.SUNDAY
        else -> null
    }
}

/**
 * The rows grouped by corridor, in the API's order. A corridor's two directions arrive adjacent and
 * share a line key, and are drawn under one roundel.
 */
fun groupByCorridor(rows: List<Frequency>): List<List<Frequency>> {
    val corridors = mutableListOf<MutableList<Frequency>>()
    for (row in rows) {
        val last = corridors.lastOrNull()
        if (last != null && last.first().lineKey == row.lineKey) {
            last += row
        } else {
            corridors += mutableListOf(row)
        }
    }
    return corridors
}
