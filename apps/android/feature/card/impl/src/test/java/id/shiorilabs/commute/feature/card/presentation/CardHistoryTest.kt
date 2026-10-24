package id.shiorilabs.commute.feature.card.presentation

import id.shiorilabs.commute.feature.card.api.CardEntry
import id.shiorilabs.commute.feature.card.api.CardKind
import id.shiorilabs.commute.feature.card.api.CardSnapshot
import java.time.Instant
import java.time.LocalDate
import org.junit.Assert.assertEquals
import org.junit.Test

class CardHistoryTest {
    // The read-only souvenir's history (KMT.md), newest first: its sums come out to the purse.
    private val kranji = CardEntry(Instant.parse("2024-12-07T11:14:20Z"), "KCI", "Kranji", -3_000)
    private val dukuhAtas = CardEntry(Instant.parse("2024-12-07T10:17:58Z"), "MRTJ", "Dukuh Atas BNI", -3_000)
    private val topUp = CardEntry(Instant.parse("2024-12-07T09:23:56Z"), null, null, 15_000)
    private val kota = CardEntry(Instant.parse("2024-12-07T07:27:13Z"), "KCI", "Jakarta Kota", -3_000)
    private val sale = CardEntry(Instant.parse("2023-11-10T12:03:11Z"), null, null, 10_000)

    private val snapshot = CardSnapshot(
        kind = CardKind.KMT,
        lastDigits = "9122",
        balanceRupiah = 16_000,
        entries = listOf(kranji, dukuhAtas, topUp, kota, sale),
        readAt = Instant.parse("2026-10-24T00:12:00Z"),
    )

    @Test
    fun `entries are grouped by their day in Jakarta, newest day first`() {
        val days = historyDays(snapshot)

        assertEquals(listOf(LocalDate.parse("2024-12-07"), LocalDate.parse("2023-11-10")), days.map { it.date })
        assertEquals(listOf(kranji, dukuhAtas, topUp, kota), days[0].entries.map { it.entry })
    }

    @Test
    fun `a day's total is what it added up to, top-ups included`() {
        assertEquals(listOf(6_000L, 10_000L), historyDays(snapshot).map { it.total })
    }

    @Test
    fun `each entry carries the balance it left, counted back from the card's`() {
        val balances = historyDays(snapshot).flatMap { day -> day.entries.map { it.balanceAfter } }

        assertEquals(listOf(16_000L, 19_000L, 22_000L, 7_000L, 10_000L), balances)
    }

    @Test
    fun `an entry just after midnight in Jakarta belongs to that day, not UTC's`() {
        val late = CardEntry(Instant.parse("2026-10-23T17:30:00Z"), "KCI", "Sudirman", -3_000)

        assertEquals(LocalDate.parse("2026-10-24"), historyDays(snapshot.copy(entries = listOf(late))).single().date)
    }
}
