package id.shiorilabs.commute.feature.card.iso

import id.shiorilabs.commute.feature.card.dump.CardDump
import id.shiorilabs.commute.feature.card.felica.hex
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class IsoDumperTest {
    private val tag = IsoTag(techs = listOf("android.nfc.tech.IsoDep", "android.nfc.tech.NfcA"), id = hex("04 A1 B2 C3"))
    private val fci = hex("6F 0A 84 03 31 32 33 A5 03 88 01 01")

    @Test
    fun `a card without a PSE says so, and nothing more is sent`() {
        val card = FakeIsoCard()
        val dump = IsoDumper(card).dump(tag)

        assertEquals(CardDump.PseDump(status = "6A82"), dump.iso!!.pse)
        assertEquals(1, card.exchanges)
        assertEquals("00A404000E315041592E5359532E444446303100", dump.transcript.single().tx)
        assertTrue(dump.complete)
    }

    @Test
    fun `a PSE's directory files are read record by record until each runs out`() {
        val record1 = hex("70 0B 61 09 4F 07 A0 00 00 00 03 10 10")
        val record2 = hex("70 03 61 01 00")
        val card = FakeIsoCard(files = mapOf("1PAY.SYS.DDF01" to fci), records = mapOf(1 to listOf(record1, record2)))

        val pse = IsoDumper(card).dump(tag).iso!!.pse!!

        assertEquals("9000", pse.status)
        assertEquals(fci.toHex(), pse.fci)
        assertEquals(listOf(CardDump.RecordDump(1, 1, record1.toHex()), CardDump.RecordDump(1, 2, record2.toHex())), pse.records)
        // SELECT, records 1-3 of SFI 1, then record 1 of SFIs 2-10.
        assertEquals(1 + 3 + 9, card.exchanges)
    }

    @Test
    fun `a card taken away mid-dump keeps what it gave`() {
        val card = FakeIsoCard(files = mapOf("1PAY.SYS.DDF01" to fci), records = mapOf(1 to listOf(hex("70 00"))), loseAfter = 2)

        val dump = IsoDumper(card).dump(tag)

        assertFalse(dump.complete)
        assertEquals(1, dump.iso!!.pse!!.records.size)
        assertEquals("Tag was lost.", dump.failure)
    }

    @Test
    fun `a card with no ISO-DEP is kept as Android found it`() {
        val dump = IsoDumper(null).dump(tag)

        assertNull(dump.iso!!.pse)
        assertTrue(dump.transcript.isEmpty())
        assertTrue(dump.complete)
    }

    private fun ByteArray.toHex() = toHexString(HexFormat { upperCase = true })
}
