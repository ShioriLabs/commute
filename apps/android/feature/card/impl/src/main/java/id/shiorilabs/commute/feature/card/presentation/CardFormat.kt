package id.shiorilabs.commute.feature.card.presentation

import java.text.DecimalFormat
import java.text.DecimalFormatSymbols
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

private val JAKARTA: ZoneId = ZoneId.of("Asia/Jakarta")
private val SYMBOLS = DecimalFormatSymbols(Locale.ROOT).apply { groupingSeparator = '.' }
private val TIME: DateTimeFormatter = DateTimeFormatter.ofPattern("HH:mm")
private val MONTHS = listOf("Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des")

/** `Rp47.500`: dots group the thousands and nothing separates the sign from the number. */
internal fun formatBalance(rupiah: Long): String = "Rp" + DecimalFormat("#,##0", SYMBOLS).format(rupiah)

/** A history amount: `−Rp3.000` out, `+Rp50.000` in, and a free ride unsigned. */
internal fun formatAmount(rupiah: Long): String = when {
    rupiah < 0 -> "−" + formatBalance(-rupiah)
    rupiah > 0 -> "+" + formatBalance(rupiah)
    else -> formatBalance(0)
}

/** When an entry happened, in Jakarta: "Hari ini 06:30", "Kemarin 18:42", else "22 Okt 07:31". */
internal fun formatEntryTime(at: Instant, now: Instant): String {
    val day = at.atZone(JAKARTA)
    val today = now.atZone(JAKARTA).toLocalDate()
    val time = TIME.format(day)
    return when (day.toLocalDate()) {
        today -> "Hari ini $time"
        today.minusDays(1) -> "Kemarin $time"
        else -> "${day.dayOfMonth} ${MONTHS[day.monthValue - 1]} $time"
    }
}
