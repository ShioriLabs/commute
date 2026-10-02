package id.shiorilabs.commute.feature.journey.domain

import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import java.util.Locale

/*
 * Departure times on the grid the API's cache can tell apart: a port of the web's
 * `utils/departure-time.ts`. Times between slot boundaries are not a finer answer, just the same
 * answer under a colder key, so everything here works in whole slots.
 *
 * Jakarta's wall clock throughout, as every other clock in the app is: a rider abroad planning a
 * Jakarta trip reads the times off Jakarta's platform signs.
 */

val JAKARTA: ZoneId = ZoneId.of("Asia/Jakarta")

/** How many days ahead the picker offers, today included. */
private const val DAYS_OFFERED = 7L

private val SLOT: Duration = Duration.ofMinutes(DEPARTURE_SLOT_MINUTES.toLong())

private val INDONESIAN = Locale.forLanguageTag("id-ID")

private val CLOCK_FORMAT = DateTimeFormatter.ofPattern("HH.mm")

/** `Sen, 14 Sep`, as the web's `toLocaleDateString('id-ID', …)` reads. */
private val DAY_FORMAT = DateTimeFormatter.ofPattern("EEE, d MMM", INDONESIAN)

/**
 * The slot [instant] falls in, floored: a time must never key to a slot that has not started, or a
 * rider asking for 08.39 is quoted the 08.40 departures.
 */
fun quantiseToSlot(instant: Instant): Instant {
    val time = instant.atZone(JAKARTA).truncatedTo(ChronoUnit.MINUTES)
    return time.withMinute(time.minute / DEPARTURE_SLOT_MINUTES * DEPARTURE_SLOT_MINUTES).toInstant()
}

/** The hours a wheel offers. */
val DEPARTURE_HOURS: List<Int> = (0..23).toList()

/** The minutes a wheel offers: slot boundaries only, so the wheel never shows a time it floors. */
val DEPARTURE_MINUTES: List<Int> = (0 until 60 step DEPARTURE_SLOT_MINUTES).toList()

/** A day plus a wall-clock time, as the instant the query carries. */
fun composeDeparture(day: LocalDate, hour: Int, minute: Int): Instant =
    day.atTime(LocalTime.of(hour, minute)).atZone(JAKARTA).toInstant()

/**
 * The same departure moved by whole slots. Nudging from "now" starts at the current slot, which is
 * what "now" already means to the cache.
 */
fun shiftBySlot(departure: Departure, slots: Int, now: Instant): Instant {
    val base = when (departure) {
        Departure.Now -> quantiseToSlot(now)
        is Departure.At -> quantiseToSlot(departure.instant)
    }
    return base.plus(SLOT.multipliedBy(slots.toLong()))
}

/** Today and the next few days. */
fun departureDays(now: Instant): List<LocalDate> {
    val today = now.atZone(JAKARTA).toLocalDate()
    return (0 until DAYS_OFFERED).map { today.plusDays(it) }
}

/** "Hari ini", "Besok", else a short date: past tomorrow, nobody counts in days. */
fun formatDepartureDay(day: LocalDate, now: Instant): String {
    val today = now.atZone(JAKARTA).toLocalDate()
    return when (ChronoUnit.DAYS.between(today, day)) {
        0L -> "Hari ini"
        1L -> "Besok"
        else -> day.format(DAY_FORMAT)
    }
}

/**
 * The departure chip's face. "Now" is a mode, so it reads as a word; a picked time names its day
 * only when that is not today.
 */
fun formatDepartureLabel(departure: Departure, now: Instant): String = when (departure) {
    Departure.Now -> "Sekarang"
    is Departure.At -> {
        val at = departure.instant.atZone(JAKARTA)
        val clock = at.format(CLOCK_FORMAT)
        if (at.toLocalDate() == now.atZone(JAKARTA).toLocalDate()) clock else "${formatDepartureDay(at.toLocalDate(), now)} $clock"
    }
}

/**
 * Whether a picked departure has been overtaken by the clock. Checked against the slot, so the
 * current slot stays good until it ends.
 */
fun isStaleDeparture(departure: Departure, now: Instant): Boolean =
    departure is Departure.At && departure.instant < quantiseToSlot(now)

/**
 * How long until a picked departure goes stale: the end of its own slot. At least a second, so a
 * boundary case can never schedule into the past and spin. `null` for "now", which never does.
 */
fun untilDepartureStale(departure: Departure, now: Instant): Duration? = when (departure) {
    Departure.Now -> null
    is Departure.At -> Duration.between(now, departure.instant.plus(SLOT)).coerceAtLeast(Duration.ofSeconds(1))
}
