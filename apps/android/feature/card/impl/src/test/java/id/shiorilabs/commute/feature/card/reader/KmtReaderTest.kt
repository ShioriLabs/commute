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

class KmtReaderTest {
    private val now = Instant.parse("2026-10-24T01:00:00Z")
    private val reader = KmtReader { now }

    @Test
    fun `reads the balance little-endian from the purse`() {
        val snapshot = reader.read(tag(balance = 47_500))!!

        assertEquals(CardKind.KMT, snapshot.kind)
        assertEquals(47_500L, snapshot.balance)
        assertEquals(now, snapshot.readAt)
    }

    @Test
    fun `keeps only the last four digits of the card number`() {
        assertEquals("4821", reader.read(tag(number = "6032984400004821"))!!.lastDigits)
    }

    @Test
    fun `reads the whole card in two exchanges`() {
        val card = card(history = listOf(krl("2026-10-23T11:42:00Z", 3_000, "48")))

        assertEquals(10_000L, reader.read(tag(card))!!.balance)
        assertEquals(2, card.exchanges)
    }

    @Test
    fun `a card that exposes only the read-only service codes reads the same, in as many exchanges`() {
        val card = card(balance = 96_030, number = "6032984400004821", history = listOf(krl("2026-10-23T11:42:00Z", 3_000, "48")), codes = Codes.READ_ONLY)
        val snapshot = reader.read(tag(card))!!

        assertEquals(96_030L, snapshot.balance)
        assertEquals("4821", snapshot.lastDigits)
        assertEquals(1, snapshot.entries.size)
        assertEquals(2, card.exchanges)
    }

    @Test
    fun `a card that exposes only the read-write service codes still reads`() {
        val snapshot = reader.read(tag(card(balance = 96_030, history = listOf(krl("2026-10-23T11:42:00Z", 3_000, "48")), codes = Codes.READ_WRITE)))!!

        assertEquals(96_030L, snapshot.balance)
        assertEquals("4821", snapshot.lastDigits)
        assertEquals(1, snapshot.entries.size)
    }

    @Test
    fun `a card without the KMT system isn't ours`() {
        val other = FakeCard(listOf(FakeCard.System(code = 0x0003, idm = IDM)))

        assertNull(reader.read(CardTag.Felica(TappedCard(IDM, PMM, 0x0003, other))))
    }

    @Test
    fun `a card that leaves mid-read gives nothing`() {
        assertNull(reader.read(tag(card(loseAfter = 1))))
    }

    @Test
    fun `lists history newest first and skips empty blocks`() {
        val snapshot = reader.read(
            tag(history = listOf(krl("2026-10-23T11:42:00Z", 3_000, "48"), EMPTY, krl("2026-10-22T00:31:00Z", 4_000, "26"))),
        )!!

        assertEquals(listOf(3_000L, 4_000L), snapshot.entries.map { -it.amount })
        assertEquals(Instant.parse("2026-10-23T11:42:00Z"), snapshot.entries.first().at)
    }

    @Test
    fun `a KRL entry names its tap-out station`() {
        val entries = reader.read(
            tag(history = listOf(krl("2026-10-23T11:42:00Z", 3_000, "48"), krl("2026-10-23T00:31:00Z", 4_000, "26"), krl("2024-12-07T07:27:13Z", 3_000, "24"))),
        )!!.entries

        assertEquals("KCI", entries[0].operator)
        assertEquals(listOf("Sudirman", "Kranji", "Jakarta Kota"), entries.map { it.place })
    }

    @Test
    fun `a KRL entry is read whatever its D11`() {
        val entry = reader.read(tag(history = listOf(entry("2026-10-23T14:33:43Z", 3_000, "01 26 01 64 01 00"))))!!.entries.single()

        assertEquals("KCI", entry.operator)
        assertEquals("Kranji", entry.place)
    }

    @Test
    fun `a KRL station we haven't seen has no name`() {
        val entry = reader.read(tag(history = listOf(krl("2026-10-23T11:42:00Z", 3_000, "7F"))))!!.entries.single()

        assertEquals("KCI", entry.operator)
        assertNull(entry.place)
    }

    @Test
    fun `an LRT entry names its tap-out station`() {
        val entry = reader.read(tag(history = listOf(entry("2026-10-23T10:20:00Z", 5_000, "00 05 00 03 01 01"))))!!.entries.single()

        assertEquals("LRTJBDB", entry.operator)
        assertEquals("Rasuna Said", entry.place)
    }

    @Test
    fun `a TransJakarta entry names no place`() {
        val entry = reader.read(tag(history = listOf(entry("2026-10-23T01:05:00Z", 3_500, "01 16 00 1C 01 01"))))!!.entries.single()

        assertEquals("TJ", entry.operator)
        assertNull(entry.place)
    }

    @Test
    fun `an MRT entry names its tap-out station`() {
        val entries = reader.read(
            tag(history = listOf(entry("2026-10-22T11:10:00Z", 0, "01 16 00 10 01 01"), entry("2024-12-07T10:17:58Z", 3_000, "01 16 00 0F 01 01"))),
        )!!.entries

        assertEquals(listOf("MRTJ", "MRTJ"), entries.map { it.operator })
        assertEquals(listOf("Bundaran HI Bank DKI", "Dukuh Atas BNI"), entries.map { it.place })
    }

    @Test
    fun `a JakLingko entry we can't place is left unread`() {
        val entry = reader.read(tag(history = listOf(entry("2026-10-23T01:05:00Z", 3_000, "01 16 00 0E 01 01"))))!!.entries.single()

        assertNull(entry.operator)
        assertNull(entry.place)
    }

    @Test
    fun `a top-up is money in`() {
        val entry = reader.read(tag(history = listOf(entry("2026-10-23T00:50:00Z", 50_000, "00 55 00 01 00 01"))))!!.entries.single()

        assertNull(entry.operator)
        assertEquals(50_000L, entry.amount)
    }

    @Test
    fun `a top-up over 65,535 reads its whole amount`() {
        val entry = reader.read(tag(history = listOf(entry("2026-10-30T04:52:28Z", 200_000, "00 55 00 01 00 01"))))!!.entries.single()

        assertEquals(200_000L, entry.amount)
    }

    @Test
    fun `an entry we don't know how to read still shows its amount`() {
        val entry = reader.read(tag(history = listOf(entry("2026-10-23T00:50:00Z", 1_000, "09 09 09 09 01 09"))))!!.entries.single()

        assertNull(entry.operator)
        assertEquals(-1_000L, entry.amount)
    }

    private fun krl(at: String, amount: Int, station: String) = entry(at, amount, "01 $station 01 01 01 00")

    private fun entry(at: String, amount: Int, modeAndPlace: String): ByteArray {
        val seconds = Instant.parse(at).epochSecond - Instant.parse("2000-01-01T00:00:00Z").epochSecond
        return int32be(seconds) + int32be(amount.toLong()) + hex(modeAndPlace) + hex("00 07")
    }

    private fun tag(
        balance: Int = 10_000,
        number: String = "6032984400004821",
        history: List<ByteArray> = emptyList(),
    ): CardTag = tag(card(balance, number, history))

    private fun tag(card: FakeCard): CardTag = CardTag.Felica(TappedCard(IDM, PMM, 0x90B7, card))

    /** Which of each service's two codes the card lists (KMT.md): both on most cards. */
    private enum class Codes { BOTH, READ_ONLY, READ_WRITE }

    private fun card(
        balance: Int = 10_000,
        number: String = "6032984400004821",
        history: List<ByteArray> = emptyList(),
        codes: Codes = Codes.BOTH,
        loseAfter: Int = Int.MAX_VALUE,
    ): FakeCard {
        val purse = FakeCard.Service(blocks = listOf(int32le(balance) + ByteArray(12)))
        val log = FakeCard.Service(blocks = history + List(16 - history.size) { EMPTY })
        val digits = FakeCard.Service(blocks = listOf(number.encodeToByteArray()))
        val readWrite = mapOf(0x1013 to purse, 0x200D to log, 0x3009 to digits)
        val readOnly = mapOf(0x1017 to purse, 0x200F to log, 0x300B to digits)
        val services = when (codes) {
            Codes.BOTH -> readWrite + readOnly
            Codes.READ_ONLY -> readOnly
            Codes.READ_WRITE -> readWrite
        }
        return FakeCard(listOf(FakeCard.System(code = 0x90B7, idm = IDM, services = services)), loseAfter = loseAfter)
    }

    private fun int32be(v: Long) = byteArrayOf((v ushr 24).toByte(), (v ushr 16).toByte(), (v ushr 8).toByte(), v.toByte())

    private fun int32le(v: Int) = byteArrayOf(v.toByte(), (v ushr 8).toByte(), (v ushr 16).toByte(), (v ushr 24).toByte())

    private companion object {
        val EMPTY = ByteArray(16)
    }
}
