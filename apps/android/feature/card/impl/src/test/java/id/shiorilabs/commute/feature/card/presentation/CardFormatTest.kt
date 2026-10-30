package id.shiorilabs.commute.feature.card.presentation

import id.shiorilabs.commute.feature.card.api.CardKind
import java.time.Instant
import java.time.LocalDate
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CardFormatTest {
    private val now = Instant.parse("2026-10-24T00:12:00Z") // 07:12 in Jakarta

    @Test
    fun `a balance groups with dots and has no space after Rp`() {
        assertEquals("Rp47.500", formatBalance(47_500))
        assertEquals("Rp0", formatBalance(0))
    }

    @Test
    fun `yen groups with commas, as Japan writes it`() {
        assertEquals("¥59", formatBalance(59, CardKind.JAPAN_IC))
        assertEquals("¥12,345", formatBalance(12_345, CardKind.JAPAN_IC))
        assertEquals("−¥199", formatAmount(-199, CardKind.JAPAN_IC))
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
    fun `a day heading says hari ini, kemarin, else the weekday and date`() {
        assertEquals("Hari ini", formatDay(LocalDate.parse("2026-10-24"), now))
        assertEquals("Kemarin", formatDay(LocalDate.parse("2026-10-23"), now))
        assertEquals("Kamis, 22 Okt", formatDay(LocalDate.parse("2026-10-22"), now))
    }

    @Test
    fun `a day from another year gives the year too`() {
        assertEquals("Sabtu, 7 Des 2024", formatDay(LocalDate.parse("2024-12-07"), now))
    }

    @Test
    fun `an entry under its day gives only the time, in Jakarta`() {
        assertEquals("00:30", formatTime(Instant.parse("2026-10-23T17:30:00Z")))
    }

    @Test
    fun `a ROC holiday is a KMT easter egg whatever the balance`() {
        listOf("2026-01-01", "2026-10-10", "2026-10-31", "2026-11-12").forEach {
            assertTrue(it, isKmtEasterEgg(LocalDate.parse(it), 47_500))
        }
    }

    @Test
    fun `a balance holding the Minguo year or 886 is an easter egg`() {
        val day = LocalDate.parse("2026-10-24") // Minguo 115
        assertTrue(isKmtEasterEgg(day, 11_500))
        assertTrue(isKmtEasterEgg(day, 1_886))
        assertFalse(isKmtEasterEgg(day, 30_029))
        assertFalse(isKmtEasterEgg(LocalDate.parse("2026-10-11"), 47_500))
    }
}
