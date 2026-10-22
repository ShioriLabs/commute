package id.shiorilabs.commute.feature.journey.domain

import java.text.DecimalFormat
import java.text.DecimalFormatSymbols
import java.time.Duration
import java.time.Instant
import java.util.Locale

/*
 * Figures as the web's `utils/format.ts` writes them, so a fare reads the same on both: `Rp6.500`
 * with no space, `13,5 km`, `07.14` on Jakarta's clock.
 */

private val SYMBOLS = DecimalFormatSymbols(Locale.forLanguageTag("id-ID"))

fun formatRupiah(amount: Int): String = "Rp" + DecimalFormat("#,##0", SYMBOLS).format(amount)

/** One decimal at most: kilometres are what a rider reads, and a second decimal is noise. */
fun formatKm(distanceM: Int): String = DecimalFormat("#,##0.#", SYMBOLS).format(distanceM / 1000.0) + " km"

/**
 * How long a journey takes, from two published times: `45 mnt`, `75 mnt`, `2 j 1 mnt`. Empty when
 * the times run backwards, which only a bad response could make them do.
 */
fun formatDuration(from: Instant, to: Instant): String {
    val minutes = Math.round(Duration.between(from, to).toMillis() / 60_000.0)
    return if (minutes < 0) "" else minutesLabel(minutes)
}

/**
 * How long a TransJakarta ride or journey probably takes: `±45 mnt`. The ± keeps an observed
 * estimate from reading as the same kind of fact as a train's published duration, and it is never a
 * clock, because an arrival time is exactly what nobody published for a bus.
 */
fun formatEstimate(seconds: Int): String = "±" + minutesLabel(maxOf(1L, Math.round(seconds / 60.0)))

/** The estimate as a journey's card prints it, counted from the first boarding; `null` without one. */
fun estimatedDurationOf(journey: Journey): String? {
    val estimate = journey.estimate ?: return null
    val seconds = estimate.durationS - estimate.fromS
    return if (seconds > 0) formatEstimate(seconds) else null
}

/** Plain minutes up to this, hours only past it: "75 mnt" beside "1 j 15 mnt" would be two shapes for one fact. */
private const val MINUTES_ONLY_MAX = 120

private fun minutesLabel(minutes: Long): String =
    if (minutes <= MINUTES_ONLY_MAX) "$minutes mnt" else "${minutes / 60} j ${minutes % 60} mnt"
