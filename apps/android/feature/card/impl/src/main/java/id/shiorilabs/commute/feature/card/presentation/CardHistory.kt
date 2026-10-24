package id.shiorilabs.commute.feature.card.presentation

import id.shiorilabs.commute.feature.card.api.CardEntry
import id.shiorilabs.commute.feature.card.api.CardSnapshot
import java.time.LocalDate

/** One day of a card's history: what it came to, and its entries, newest first. */
internal data class HistoryDay(val date: LocalDate, val total: Long, val entries: List<HistoryEntry>)

/** An entry with the balance the card was left with after it. */
internal data class HistoryEntry(val entry: CardEntry, val balanceAfter: Long)

/**
 * The history by day in Jakarta, newest first. The card holds no balance per entry, so each is
 * counted back from the one it holds now: the newest entry left the card's balance, and every
 * older one left that, less what came after it.
 */
internal fun historyDays(snapshot: CardSnapshot): List<HistoryDay> {
    var balance = snapshot.balanceRupiah
    val withBalances = snapshot.entries.map { entry ->
        HistoryEntry(entry, balance).also { balance -= entry.amountRupiah }
    }
    return withBalances
        .groupBy { jakartaDate(it.entry.at) }
        .map { (date, entries) -> HistoryDay(date, entries.sumOf { it.entry.amountRupiah }, entries) }
}
