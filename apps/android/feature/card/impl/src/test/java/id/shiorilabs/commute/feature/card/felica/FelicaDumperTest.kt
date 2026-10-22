package id.shiorilabs.commute.feature.card.felica

import id.shiorilabs.commute.feature.card.dump.CardDump
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class FelicaDumperTest {
    private val idm1 = hex("11 2E 34 56 78 9A BC DE")

    private val card = FakeCard(
        listOf(
            FakeCard.System(
                code = 0x0003,
                idm = IDM,
                services = mapOf(
                    // Random, read only, no key: 3 blocks.
                    0x090F to FakeCard.Service(blocks = blocks(3)),
                    // Cyclic, read only, no key: 14 blocks, past one batch of 12.
                    0x184F to FakeCard.Service(blocks = blocks(14)),
                    // Purse, direct, key needed: listed, never read.
                    0x1810 to FakeCard.Service(keyVersion = 0x0203),
                ),
                areas = mapOf(0x0000 to 0x0000, 0x1000 to 0x0102),
            ),
            FakeCard.System(
                code = 0xFE00,
                idm = idm1,
                services = mapOf(0x1A8B to FakeCard.Service(blocks = blocks(1))),
            ),
        ),
    )

    private fun dump(transport: FelicaTransport = card): CardDump =
        FelicaDumper(transport, now = { 0L }).dump(tagIdm = IDM, tagPmm = PMM, tagSystemCode = 0x0003)

    @Test
    fun `every system the card lists is dumped, by the IDm its own poll gave`() {
        val dump = dump()
        assertEquals(listOf("0003", "FE00"), dump.systems.map { it.code })
        assertEquals(listOf(IDM.hex(), idm1.hex()), dump.systems.map { it.idm })
        assertTrue(dump.complete)
        assertNull(dump.failure)
    }

    @Test
    fun `a service that needs no key is read block by block until the card says there are no more`() {
        val services = dump().systems[0].services.associateBy { it.code }
        assertEquals(blocks(3).map { it.hex() }, services.getValue("090F").blocks)
        assertEquals(blocks(14).map { it.hex() }, services.getValue("184F").blocks)
        assertEquals("01A8", services.getValue("090F").stop)
    }

    @Test
    fun `a service that needs a key is listed with its key version but never read`() {
        val purse = dump().systems[0].services.single { it.code == "1810" }
        assertFalse(purse.readable)
        assertEquals("0203", purse.keyVersion)
        assertEquals(emptyList<String>(), purse.blocks)
        assertNull(purse.stop)
    }

    @Test
    fun `nodes the card doesn't have aren't in the dump, areas are`() {
        val system = dump().systems[0]
        assertEquals(setOf("090F", "184F", "1810"), system.services.map { it.code }.toSet())
        assertEquals(listOf("0000", "1000"), system.areas.map { it.code })
    }

    @Test
    fun `a system the card doesn't list but answers a poll for is kept as a probe`() {
        val withLite = FakeCard(
            listOf(
                FakeCard.System(code = 0x0003, idm = IDM),
                FakeCard.System(code = 0x88B4, idm = hex("03 FE 00 1D 00 00 00 01"), listed = false),
            ),
        )
        val probes = dump(withLite).probes.associateBy { it.code }
        assertEquals("03FE001D00000001", probes.getValue("88B4").idm)
        assertNull(probes.getValue("957A").idm)
    }

    @Test
    fun `a card taken away mid-read leaves what was read, marked incomplete`() {
        val systems = listOf(FakeCard.System(code = 0x0003, idm = IDM, services = mapOf(0x090F to FakeCard.Service(blocks = blocks(3)))))
        // Request System Code, the system's poll, the search for keyless services, then the read:
        // a batch of 12 refused, blocks 0, 1 and 2 one at a time, block 3 refused. Lost after that.
        val throughTheRead = 1 + 1 + NODE_NUMBERS * NO_KEY_SERVICE_ATTRIBUTES.size / MAX_NODES + 5
        val dump = dump(FakeCard(systems, loseAfter = throughTheRead))
        assertFalse(dump.complete)
        assertNotNull(dump.failure)
        val service = dump.systems.single().services.single { it.code == "090F" }
        assertEquals(blocks(3).map { it.hex() }, service.blocks)
        assertEquals("Tag was lost.", dump.transcript.last().error)
        assertNull(dump.transcript.last().rx)
    }

    @Test
    fun `a garbled answer ends the dump as incomplete instead of crashing`() {
        val dump = dump(FakeCard(listOf(FakeCard.System(code = 0x0003, idm = IDM)), garble = setOf(0)))
        assertFalse(dump.complete)
        assertEquals(1, dump.transcript.size)
    }

    @Test
    fun `every exchange is in the transcript, in order, as sent and as answered`() {
        val dump = dump()
        assertEquals(card.exchanges, dump.transcript.size)
        assertEquals(FelicaCommand.requestSystemCode(IDM).hex(), dump.transcript.first().tx)
        // Only the probes for systems this card hasn't got go unanswered.
        assertEquals(2, dump.transcript.count { it.rx == null })
        assertTrue(dump.transcript.filter { it.rx == null }.all { it.tx.startsWith("060088B4") || it.tx.startsWith("0600957A") })
    }
}
