package id.shiorilabs.commute.feature.card.presentation

import id.shiorilabs.commute.feature.card.api.CardKind
import id.shiorilabs.commute.feature.card.api.CardSnapshot
import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Test

class CardBudgetTest {
    private fun card(balance: Long, kind: CardKind = CardKind.KMT) =
        CardSnapshot(kind, "4821", balance, emptyList(), Instant.parse("2026-11-03T00:00:00Z"))

    @Test
    fun `well above two fares covers the way back`() {
        assertEquals(CardBudget.RoundTrip(left = 6_500), cardBudget(card(12_000), fare = 5_500))
    }

    @Test
    fun `exactly two fares still covers the way back`() {
        assertEquals(CardBudget.RoundTrip(left = 5_500), cardBudget(card(11_000), fare = 5_500))
    }

    @Test
    fun `a rupiah under two fares only covers the way there`() {
        assertEquals(CardBudget.OneWay(left = 5_499), cardBudget(card(10_999), fare = 5_500))
    }

    @Test
    fun `exactly one fare covers the way there and leaves nothing`() {
        assertEquals(CardBudget.OneWay(left = 0), cardBudget(card(5_500), fare = 5_500))
    }

    @Test
    fun `a rupiah under the fare is short by that rupiah`() {
        assertEquals(CardBudget.Short(missing = 1), cardBudget(card(5_499), fare = 5_500))
    }

    @Test
    fun `an empty card is short by the whole fare`() {
        assertEquals(CardBudget.Short(missing = 5_500), cardBudget(card(0), fare = 5_500))
    }

    @Test
    fun `an e-money card is held to the fare like a KMT`() {
        assertEquals(CardBudget.Short(missing = 1_500), cardBudget(card(4_000, CardKind.EMONEY), fare = 5_500))
    }

    @Test
    fun `yen isn't compared with a rupiah fare`() {
        assertEquals(CardBudget.NotRupiah, cardBudget(card(12_000, CardKind.JAPAN_IC), fare = 5_500))
    }
}
