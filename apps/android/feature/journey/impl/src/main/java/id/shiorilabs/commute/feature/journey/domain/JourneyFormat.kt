package id.shiorilabs.commute.feature.journey.domain

import java.text.DecimalFormat
import java.text.DecimalFormatSymbols
import java.time.Duration
import java.time.Instant
import java.time.format.DateTimeFormatter
import java.util.Locale

/*
 * Figures as the web's `utils/format.ts` writes them, so a fare reads the same on both: `Rp6.500`
 * with no space, `13,5 km`, `07.14` on Jakarta's clock.
 */

private val SYMBOLS = DecimalFormatSymbols(Locale.forLanguageTag("id-ID"))

private val CLOCK = DateTimeFormatter.ofPattern("HH.mm").withZone(JAKARTA)

fun formatRupiah(amount: Int): String = "Rp" + DecimalFormat("#,##0", SYMBOLS).format(amount)

/** One decimal at most: kilometres are what a rider reads, and a second decimal is noise. */
fun formatKm(distanceM: Int): String = DecimalFormat("#,##0.#", SYMBOLS).format(distanceM / 1000.0) + " km"

fun formatClock(instant: Instant): String = CLOCK.format(instant)

/**
 * How long a journey takes, from two published times: `45 mnt`, `1 j 5 mnt`. Empty when the times
 * run backwards, which only a bad response could make them do.
 */
fun formatDuration(from: Instant, to: Instant): String {
    val minutes = Math.round(Duration.between(from, to).toMillis() / 60_000.0)
    if (minutes < 0) {
        return ""
    }
    val hours = minutes / 60
    return if (hours > 0) "$hours j ${minutes % 60} mnt" else "$minutes mnt"
}
