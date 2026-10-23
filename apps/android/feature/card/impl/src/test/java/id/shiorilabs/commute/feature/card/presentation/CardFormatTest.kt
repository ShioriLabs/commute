package id.shiorilabs.commute.feature.card.presentation

import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Test

class CardFormatTest {
    private val now = Instant.parse("2026-10-24T00:12:00Z") // 07:12 in Jakarta

    @Test
    fun `a balance groups with dots and has no space after Rp`() {
        assertEquals("Rp47.500", formatBalance(47_500))
        assertEquals("Rp0", formatBalance(0))
    }

    @Test
    fun `money out carries a minus sign`() {
        assertEquals("−Rp3.000", formatAmount(-3_000))
    }

    @Test
    fun `money in carries a plus sign`() {
        assertEquals("+Rp50.000", formatAmount(50_000))
    }

    @Test
    fun `a free ride has no sign`() {
        assertEquals("Rp0", formatAmount(0))
    }

    @Test
    fun `an entry from today says hari ini`() {
        assertEquals("Hari ini 06:30", formatEntryTime(Instant.parse("2026-10-23T23:30:00Z"), now))
    }

    @Test
    fun `an entry from yesterday says kemarin`() {
        assertEquals("Kemarin 18:42", formatEntryTime(Instant.parse("2026-10-23T11:42:00Z"), now))
    }

    @Test
    fun `an older entry gives its date`() {
        assertEquals("22 Okt 07:31", formatEntryTime(Instant.parse("2026-10-22T00:31:00Z"), now))
    }

    @Test
    fun `midnight in Jakarta is the new day, not UTC's`() {
        // 17:30Z on the 23rd is 00:30 on the 24th in Jakarta.
        assertEquals("Hari ini 00:30", formatEntryTime(Instant.parse("2026-10-23T17:30:00Z"), now))
    }
}
