package id.shiorilabs.commute.core.wearable

import id.shiorilabs.commute.core.time.JAKARTA
import id.shiorilabs.commute.core.time.ServiceDayName
import id.shiorilabs.commute.core.time.serviceDayOf
import id.shiorilabs.commute.core.time.servicePosition
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime

/**
 * A saved station as the watch gets it, for its departures complication: every direction's
 * timetable for each kind of service day, so the watch counts the next train down on its own clock,
 * any day, with the phone out of reach. The phone sends it again when the board changes.
 *
 * @property builtAt When the phone put it together, in epoch milliseconds: a copy grown old is asked for again.
 */
@Serializable
data class WearStation(
    /** `OPERATOR-CODE`. */
    val id: String,
    val name: String,
    val builtAt: Long,
    val directions: List<WearDirection>,
) {

    fun encode(): ByteArray = JSON.encodeToString(serializer(), this).encodeToByteArray()

    companion object {

        private val JSON = Json { ignoreUnknownKeys = true }

        /** `null` for bytes from an app version whose station no longer decodes. */
        fun decode(bytes: ByteArray): WearStation? = runCatching {
            JSON.decodeFromString(serializer(), bytes.decodeToString())
        }.getOrNull()
    }
}

/**
 * One line's one direction from the station, as its board groups it.
 *
 * @property key Stable across syncs: what a complication slot remembers, `OPERATOR:CODE|group`.
 * @property label The stations the direction is signed with, joined as the phone's board joins them.
 * @property days Its departures on each kind of day it runs; a day it doesn't run is missing.
 */
@Serializable
data class WearDirection(
    val key: String,
    /** `OPERATOR:CODE`. */
    val lineKey: String,
    val lineName: String,
    /** ARGB. */
    val color: Int,
    val label: String,
    /** Curated platform, e.g. `3/4`. */
    val platform: String? = null,
    val days: Map<ServiceDayName, WearDay>,
)

/**
 * One kind of day's departures in a direction, as minutes since local midnight (Jakarta).
 *
 * @property start The minute the LINE's service day starts on that day (its first train after the
 *   overnight break, over every direction), so a 00.34 departure sorts after 23.59; `null` for a line
 *   with no break, which the rollover hour stands in for.
 */
@Serializable
data class WearDay(
    val start: Int?,
    val minutes: List<Int>,
)

/**
 * The next [n] departures after [now], soonest first: the rest of the service day running, then
 * the next service day's first trains once it runs out.
 */
fun WearDirection.nextDepartures(now: Instant, n: Int): List<Instant> {
    val local = now.atZone(JAKARTA).toLocalDateTime()
    val today = local.minusHours(ROLLOVER_HOUR).toLocalDate()
    return sequenceOf(today, today.plusDays(1))
        .flatMap { date -> departuresOn(date) }
        .filter { it.isAfter(now) }
        .take(n)
        .toList()
}

/** The departures of the service day that started on [date], earliest first. */
private fun WearDirection.departuresOn(date: LocalDate): Sequence<Instant> {
    val day = days[serviceDayOf(date.atTime(NOON))] ?: return emptySequence()
    val start = day.start ?: ROLLOVER_MINUTE
    return day.minutes
        .sortedBy { servicePosition(it, start) }
        .asSequence()
        .map { minute ->
            // A departure before the line's start runs after midnight, on the next calendar day.
            val onDate = if (minute < start) date.plusDays(1) else date
            onDate.atTime(LocalTime.of(minute / 60, minute % 60)).atZone(JAKARTA).toInstant()
        }
}

/** Mirrors the service day's rollover in `core:common`: the night belongs to the day before it. */
private const val ROLLOVER_HOUR = 3L
private const val ROLLOVER_MINUTE = 3 * 60

/** A time well inside a calendar day, for asking which kind of service day it is. */
private val NOON = LocalTime.NOON
