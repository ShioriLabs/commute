package id.shiorilabs.commute.feature.card.presentation

import id.shiorilabs.commute.feature.card.api.CardKind
import java.text.DecimalFormat
import java.text.DecimalFormatSymbols
import java.time.Instant
import java.time.LocalDate
import java.time.MonthDay
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

private val JAKARTA: ZoneId = ZoneId.of("Asia/Jakarta")
private val SYMBOLS = DecimalFormatSymbols(Locale.ROOT).apply { groupingSeparator = '.' }
private val TIME: DateTimeFormatter = DateTimeFormatter.ofPattern("HH:mm")
private val MONTHS = listOf("Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des")
private val WEEKDAYS = listOf("Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu")

/**
 * Money in the card's own: `Rp47.500` on a KMT, dots grouping the thousands, and `¥12,345` on a
 * Japanese card, commas grouping them as Japan writes it. Nothing separates the sign from the number.
 */
internal fun formatBalance(amount: Long, kind: CardKind = CardKind.KMT): String = when (kind) {
    CardKind.KMT -> "Rp" + DecimalFormat("#,##0", SYMBOLS).format(amount)
    CardKind.JAPAN_IC -> "¥" + DecimalFormat("#,##0", DecimalFormatSymbols(Locale.ROOT)).format(amount)
}

/** A history amount: `−Rp3.000` out, `+Rp50.000` in, and a free ride unsigned. */
internal fun formatAmount(amount: Long, kind: CardKind = CardKind.KMT): String = when {
    amount < 0 -> "−" + formatBalance(-amount, kind)
    amount > 0 -> "+" + formatBalance(amount, kind)
    else -> formatBalance(0, kind)
}

/** Founding of the ROC, Double Ten, and the birthdays of Chiang Kai-shek and Sun Yat-sen. */
private val EGG_DAYS = setOf(
    MonthDay.of(1, 1),
    MonthDay.of(10, 10),
    MonthDay.of(10, 31),
    MonthDay.of(11, 12),
)

/** The Minguo calendar counts from 1912, the ROC's first year. */
private const val MINGUO_EPOCH = 1911

/**
 * Whether a KMT card's rail button should go Taiwan: on a ROC holiday, or when the raw balance (no
 * dots) holds this year's Minguo number or 886, Taiwan's calling code.
 */
internal fun isKmtEasterEgg(today: LocalDate, balance: Long): Boolean {
    val digits = balance.toString()
    return MonthDay.from(today) in EGG_DAYS ||
        digits.contains((today.year - MINGUO_EPOCH).toString()) ||
        digits.contains("886")
}

/** The day [at] falls on in Jakarta, which is what the history groups by. */
internal fun jakartaDate(at: Instant): LocalDate = at.atZone(JAKARTA).toLocalDate()

/** A day's heading: "Hari ini", "Kemarin", else "Kamis, 22 Okt", with the year when it isn't this one. */
internal fun formatDay(date: LocalDate, now: Instant): String {
    val today = jakartaDate(now)
    return when (date) {
        today -> "Hari ini"
        today.minusDays(1) -> "Kemarin"
        else -> {
            val day = "${WEEKDAYS[date.dayOfWeek.value - 1]}, ${date.dayOfMonth} ${MONTHS[date.monthValue - 1]}"
            if (date.year == today.year) day else "$day ${date.year}"
        }
    }
}

/** An entry's time under its day's heading, in Jakarta: "18:14". */
internal fun formatTime(at: Instant): String = TIME.format(at.atZone(JAKARTA))
