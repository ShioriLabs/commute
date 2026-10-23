package id.shiorilabs.commute.feature.card.reader

import id.shiorilabs.commute.feature.card.api.CardKind
import id.shiorilabs.commute.feature.card.api.CardSnapshot
import id.shiorilabs.commute.feature.card.felica.FakeCard
import id.shiorilabs.commute.feature.card.felica.IDM
import id.shiorilabs.commute.feature.card.felica.PMM
import id.shiorilabs.commute.feature.card.felica.TappedCard
import java.time.Duration
import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class CardSessionTest {
    private var clock = Instant.parse("2026-10-24T01:00:00Z")
    private val session = CardSession { clock }

    @Test
    fun `starts with nothing to show`() {
        assertNull(session.snapshot.value)
    }

    @Test
    fun `a read shows up`() {
        session.show(snapshot(1_000))

        assertEquals(1_000L, session.snapshot.value?.balanceRupiah)
    }

    @Test
    fun `a second card replaces the first`() {
        session.show(snapshot(1_000))
        session.show(snapshot(2_000))

        assertEquals(2_000L, session.snapshot.value?.balanceRupiah)
    }

    @Test
    fun `goes away after five idle minutes`() {
        session.show(snapshot(1_000))

        clock += Duration.ofMinutes(5)
        session.expireIfIdle()

        assertNull(session.snapshot.value)
    }

    @Test
    fun `stays until the five minutes are up`() {
        session.show(snapshot(1_000))

        clock += Duration.ofMinutes(4) + Duration.ofSeconds(59)
        session.expireIfIdle()

        assertEquals(1_000L, session.snapshot.value?.balanceRupiah)
    }

    @Test
    fun `touching it starts the five minutes again`() {
        session.show(snapshot(1_000))
        clock += Duration.ofMinutes(4)
        session.touch()

        clock += Duration.ofMinutes(4)
        session.expireIfIdle()

        assertEquals(1_000L, session.snapshot.value?.balanceRupiah)
    }

    @Test
    fun `dismissing clears it`() {
        session.show(snapshot(1_000))

        session.dismiss()

        assertNull(session.snapshot.value)
    }

    @Test
    fun `the first reader to know the card wins`() {
        val readers = CardReaders(setOf(Fixed(null), Fixed(snapshot(7)), Fixed(snapshot(8))))

        assertEquals(7L, readers.read(anyTag())?.balanceRupiah)
    }

    @Test
    fun `a card no reader knows reads as nothing`() {
        assertNull(CardReaders(setOf(Fixed(null))).read(anyTag()))
    }

    private fun snapshot(balance: Long) = CardSnapshot(CardKind.KMT, "4821", balance, emptyList(), clock)

    private fun anyTag() = CardTag.Felica(TappedCard(IDM, PMM, 0x90B7, FakeCard(emptyList())))

    private class Fixed(private val result: CardSnapshot?) : CardReader {
        override val kind = CardKind.KMT

        override fun read(tag: CardTag) = result
    }
}
