package id.shiorilabs.commute.feature.card.reader

import id.shiorilabs.commute.feature.card.api.CardKind
import id.shiorilabs.commute.feature.card.felica.FakeCard
import id.shiorilabs.commute.feature.card.felica.IDM
import id.shiorilabs.commute.feature.card.felica.PMM
import id.shiorilabs.commute.feature.card.felica.TappedCard
import id.shiorilabs.commute.feature.card.felica.hex
import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class JapanIcReaderTest {
    private val now = Instant.parse("2026-10-25T12:00:00Z")
    private val reader = JapanIcReader(now = { now })

    @Test
    fun `reads the yen little-endian from the purse`() {
        val snapshot = reader.read(tag(card()))!!

        assertEquals(CardKind.JAPAN_IC, snapshot.kind)
        assertEquals(59L, snapshot.balance)
        assertNull(snapshot.lastDigits)
        assertEquals(now, snapshot.readAt)
    }

    @Test
    fun `reads both bytes of the balance`() {
        assertEquals(12_345L, reader.read(tag(card(purse = "00 00 00 00 00 00 00 00 00 00 00 39 30 00 00 01")))!!.balance)
    }

    @Test
    fun `each entry's amount is what its balance moved from the one before`() {
        val entries = reader.read(tag(card()))!!.entries

        assertEquals(listOf(-199L, -242L, 500L), entries.map { it.amount })
        assertEquals(listOf(null, null, null), entries.map { it.operator })
    }

    @Test
    fun `a ride says who ran it, and nothing about a line that has no one name`() {
        val entries = read(mapOf(0x2D to JapanLine("東日本旅客鉄道", null))).entries

        assertEquals(listOf("東日本旅客鉄道", "東日本旅客鉄道", null), entries.map { it.operator })
        assertEquals(listOf(null, null, null), entries.map { it.place })
    }

    @Test
    fun `a ride on a named line names it`() {
        val entry = read(mapOf(0x2D to JapanLine("東日本旅客鉄道", "両毛線"))).entries.first()

        assertEquals("両毛線", entry.place)
        assertEquals("東日本旅客鉄道", entry.operator)
    }

    @Test
    fun `a ride between two companies goes from one to the other`() {
        val lines = mapOf(0x2D to JapanLine("東日本旅客鉄道", "両毛線"), 0x2E to JapanLine("わたらせ渓谷鐵道", "わたらせ渓谷線"))
        val ride = hex("16 01 00 02 32 AA 2D 20 2E 05 3B 00 00 00 05 00")

        val entry = read(lines, card(history = listOf(ride))).entries.first()

        assertEquals("東日本旅客鉄道 → わたらせ渓谷鐵道", entry.operator)
        assertEquals("両毛線 → わたらせ渓谷線", entry.place)
    }

    @Test
    fun `a ride on a line the table lacks stays unnamed`() {
        val entry = read(emptyMap()).entries.first()

        assertNull(entry.place)
        assertNull(entry.operator)
    }

    @Test
    fun `the card's issue is told from its rides`() {
        val entries = reader.read(tag(card()))!!.entries

        assertEquals(listOf(false, false, true), entries.map { it.issue })
    }

    @Test
    fun `an entry carries its day and no time`() {
        val entries = reader.read(tag(card()))!!.entries

        // 2025-05-10 and 2025-05-08, each at the day's start in Jakarta (UTC+7).
        assertEquals(
            listOf("2025-05-09T17:00:00Z", "2025-05-09T17:00:00Z", "2025-05-07T17:00:00Z").map(Instant::parse),
            entries.map { it.at },
        )
        assertEquals(listOf(false, false, false), entries.map { it.timeKnown })
    }

    @Test
    fun `a full history leaves out the oldest entry, whose amount it can't know`() {
        val full = List(20) { i -> ride(day = "32AA", balanceAfter = 1_000 + i) }

        val entries = reader.read(tag(card(history = full)))!!.entries

        assertEquals(19, entries.size)
        assertEquals(-1L, entries.last().amount)
    }

    @Test
    fun `reads the whole card in two exchanges`() {
        val card = card()

        reader.read(tag(card))
        assertEquals(2, card.exchanges)
    }

    @Test
    fun `a KMT isn't a Japanese card`() {
        val kmt = FakeCard(listOf(FakeCard.System(code = 0x90B7, idm = IDM)))

        assertNull(reader.read(CardTag.Felica(TappedCard(IDM, PMM, 0x90B7, kmt))))
    }

    @Test
    fun `a card that won't give its purse up gives nothing`() {
        assertNull(reader.read(tag(FakeCard(listOf(FakeCard.System(code = 0x0003, idm = IDM))))))
    }

    @Test
    fun `a card that leaves mid-read gives nothing`() {
        assertNull(reader.read(tag(card(loseAfter = 1))))
    }

    private fun ride(day: String, balanceAfter: Int) =
        hex("16 01 00 02 $day 2D 20 2D 22") + byteArrayOf(balanceAfter.toByte(), (balanceAfter ushr 8).toByte()) + hex("00 00 05 00")

    private fun card(
        purse: String = "00 00 00 00 00 00 00 00 20 00 00 3B 00 00 00 05",
        // The PASMO dump's history (JAPAN_IC.md), newest first, and an empty slot as the card writes it.
        history: List<ByteArray> = listOf(
            hex("16 01 00 02 32 AA 2D 20 2D 22 3B 00 00 00 05 00"),
            hex("17 01 00 02 32 AA 2D 1A 2D 20 02 01 00 00 03 00"),
            hex("08 07 00 00 32 A8 00 00 00 00 F4 01 00 00 01 00"),
        ),
        loseAfter: Int = Int.MAX_VALUE,
    ): FakeCard {
        val slots = history + List(20 - history.size) { hex("00 00 00 80 00 00 00 00 00 00 00 00 00 00 00 00") }
        val services = mapOf(
            0x008B to FakeCard.Service(blocks = listOf(hex(purse))),
            0x090F to FakeCard.Service(blocks = slots),
        )
        return FakeCard(listOf(FakeCard.System(code = 0x0003, idm = IDM, services = services)), loseAfter = loseAfter)
    }

    private fun tag(card: FakeCard) = CardTag.Felica(TappedCard(IDM, PMM, 0x0003, card))

    private fun read(lines: Map<Int, JapanLine>, card: FakeCard = card()) =
        JapanIcReader(now = { now }, lines = lines::get).read(tag(card))!!
}
