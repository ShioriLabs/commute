package id.shiorilabs.commute.feature.card.felica

import org.junit.Assert.assertEquals
import org.junit.Test

class FelicaTimingTest {
    @Test
    fun `the smallest parameter is one unit of T`() {
        assertEquals(0.302, maxResponseTimeMs(parameter = 0x00, n = 0), 0.001)
    }

    @Test
    fun `the largest parameter on 32 nodes is the 5,104 ms worst case the NFC guidelines quote`() {
        assertEquals(5104.0, maxResponseTimeMs(parameter = 0xFF, n = 32), 1.0)
    }

    @Test
    fun `the largest parameter on 15 blocks is the 2,475 ms the NFC guidelines quote`() {
        assertEquals(2475.0, maxResponseTimeMs(parameter = 0xFF, n = 15), 1.0)
    }

    @Test
    fun `the exponent, B and A sit high to low in the byte`() {
        // E = 1, B = 2, A = 3: T x (3n + 4) x 4.
        assertEquals(0.30206 * (3 * 5 + 4) * 4, maxResponseTimeMs(parameter = 0b01_010_011, n = 5), 0.001)
    }

    @Test
    fun `the timeout covers the slowest command the dumper sends, with room to spare, never past the cap`() {
        // PMm D10 = 0x4B (Request Service), D11 = 0x42, D13 = 0x85 (Read Without Encryption).
        val slowest = maxOf(maxResponseTimeMs(0x4B, 32), maxResponseTimeMs(0x42, 0), maxResponseTimeMs(0x85, READ_BATCH))
        val timeout = transceiveTimeoutMs(PMM)
        assert(timeout >= slowest) { "$timeout < $slowest" }
        assertEquals(TIMEOUT_CAP_MS, transceiveTimeoutMs(hex("00 00 FF FF FF FF FF FF")))
    }
}
