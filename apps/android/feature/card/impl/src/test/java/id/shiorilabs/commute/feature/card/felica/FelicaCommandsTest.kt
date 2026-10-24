package id.shiorilabs.commute.feature.card.felica

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test

class FelicaCommandsTest {
    @Test
    fun `polling carries the system code, request code and time slot after its own length`() {
        assertArrayEquals(hex("06 00 FF FF 01 00"), FelicaCommand.polling(systemCode = 0xFFFF, requestCode = 0x01))
        assertArrayEquals(hex("06 00 12 FC 00 03"), FelicaCommand.polling(systemCode = 0x12FC, requestCode = 0x00, timeSlot = 0x03))
    }

    @Test
    fun `request system code is the code and the IDm`() {
        assertArrayEquals(hex("0A 0C 01 2E 34 56 78 9A BC DE"), FelicaCommand.requestSystemCode(IDM))
    }

    @Test
    fun `request service lists its node codes little-endian`() {
        val frame = FelicaCommand.requestService(IDM, listOf(0x1009, 0xFFFF))
        assertArrayEquals(hex("0F 02 01 2E 34 56 78 9A BC DE 02 09 10 FF FF"), frame)
    }

    @Test(expected = IllegalArgumentException::class)
    fun `request service refuses more than 32 nodes`() {
        FelicaCommand.requestService(IDM, List(33) { it })
    }

    @Test
    fun `read without encryption names one service and each block as a 2-byte element`() {
        val frame = FelicaCommand.readWithoutEncryption(IDM, serviceCode = 0x090F, blocks = listOf(0, 1, 2))
        assertArrayEquals(hex("14 06 01 2E 34 56 78 9A BC DE 01 0F 09 03 80 00 80 01 80 02"), frame)
    }

    @Test
    fun `a block past 255 takes the 3-byte element, its number little-endian`() {
        val frame = FelicaCommand.readWithoutEncryption(IDM, serviceCode = 0x090F, blocks = listOf(255, 300))
        assertArrayEquals(hex("13 06 01 2E 34 56 78 9A BC DE 01 0F 09 02 80 FF 00 2C 01"), frame)
    }

    @Test
    fun `a read across services lists each service once and points every block at its place in that list`() {
        val frame = FelicaCommand.readWithoutEncryption(
            IDM,
            listOf(ServiceBlock(0x1017, 0), ServiceBlock(0x300B, 0), ServiceBlock(0x200F, 0), ServiceBlock(0x200F, 1)),
        )
        assertArrayEquals(hex("1A 06 01 2E 34 56 78 9A BC DE 03 17 10 0B 30 0F 20 04 80 00 81 00 82 00 82 01"), frame)
    }

    @Test(expected = IllegalArgumentException::class)
    fun `a read refuses more than 16 services`() {
        FelicaCommand.readWithoutEncryption(IDM, List(17) { ServiceBlock(serviceCode(it, 0x0B), 0) })
    }

    @Test
    fun `the manual's own example element - block 3 of the first service - is 80 03`() {
        assertArrayEquals(hex("80 03"), FelicaCommand.blockListElement(serviceIndex = 0, block = 3))
    }

    @Test
    fun `a service code is its number over its attribute`() {
        assertEquals(0x090F, serviceCode(number = 0x24, attribute = 0x0F))
        assertEquals(0x24, serviceNumber(0x090F))
        assertEquals(0x0F, serviceAttribute(0x090F))
    }

    @Test
    fun `odd attributes need no key, and only the defined ones count as services`() {
        assertEquals(listOf(0x09, 0x0B, 0x0D, 0x0F, 0x11, 0x13, 0x15, 0x17), NO_KEY_SERVICE_ATTRIBUTES)
        assertEquals(listOf(0x08, 0x0A, 0x0C, 0x0E, 0x10, 0x12, 0x14, 0x16), KEYED_SERVICE_ATTRIBUTES)
    }
}
