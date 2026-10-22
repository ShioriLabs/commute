package id.shiorilabs.commute.feature.card.felica

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class FelicaResponsesTest {
    @Test
    fun `a polling response gives the IDm, the PMm, and the request data when there is some`() {
        val bare = FelicaResponse.polling(hex("12 01 01 2E 34 56 78 9A BC DE 10 0B 4B 42 84 85 D0 FF"))!!
        assertArrayEquals(IDM, bare.idm)
        assertArrayEquals(PMM, bare.pmm)
        assertNull(bare.requestData)

        val asked = FelicaResponse.polling(hex("14 01 01 2E 34 56 78 9A BC DE 10 0B 4B 42 84 85 D0 FF 00 03"))!!
        assertEquals(0x0003, asked.requestData)
    }

    @Test
    fun `request system code lists every system from 0 up`() {
        val codes = FelicaResponse.requestSystemCode(hex("0F 0D 01 2E 34 56 78 9A BC DE 02 00 03 FE 00"), IDM)
        assertEquals(listOf(0x0003, 0xFE00), codes)
    }

    @Test
    fun `request service gives a key version per node, FFFF where there's no such node`() {
        val versions = FelicaResponse.requestService(hex("0F 03 01 2E 34 56 78 9A BC DE 02 01 00 FF FF"), IDM)
        assertEquals(listOf(0x0001, NO_SUCH_NODE), versions)
    }

    @Test
    fun `a read that worked gives its status and 16 bytes per block`() {
        val block0 = "00".repeat(16)
        val block1 = "11".repeat(16)
        val read = FelicaResponse.readWithoutEncryption(hex("2D 07 01 2E 34 56 78 9A BC DE 00 00 02 $block0 $block1"), IDM)!!
        assertEquals(0, read.statusFlag1)
        assertEquals(0, read.statusFlag2)
        assertEquals(listOf(block0, block1), read.blocks.map { it.toHexString() })
    }

    @Test
    fun `a read that failed gives its status and no blocks`() {
        val read = FelicaResponse.readWithoutEncryption(hex("0C 07 01 2E 34 56 78 9A BC DE 01 A8"), IDM)!!
        assertEquals(0x01, read.statusFlag1)
        assertEquals(0xA8, read.statusFlag2)
        assertEquals(emptyList<ByteArray>(), read.blocks)
    }

    @Test
    fun `a frame whose length byte disagrees with its size isn't read at all`() {
        assertNull(FelicaResponse.requestService(hex("10 03 01 2E 34 56 78 9A BC DE 02 01 00 FF FF"), IDM))
    }

    @Test
    fun `a frame for another command or another card isn't read at all`() {
        assertNull(FelicaResponse.requestService(hex("0F 0D 01 2E 34 56 78 9A BC DE 02 01 00 FF FF"), IDM))
        assertNull(FelicaResponse.requestService(hex("0F 03 FF 2E 34 56 78 9A BC DE 02 01 00 FF FF"), IDM))
    }

    @Test
    fun `a frame that's cut short isn't read at all`() {
        assertNull(FelicaResponse.requestService(hex("0D 03 01 2E 34 56 78 9A BC DE 02 01 00"), IDM))
        assertNull(FelicaResponse.readWithoutEncryption(hex("1D 07 01 2E 34 56 78 9A BC DE 00 00 02 ${"00".repeat(16)}"), IDM))
        assertNull(FelicaResponse.polling(hex("05 01 01 2E 34")))
    }
}
