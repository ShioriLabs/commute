package id.shiorilabs.commute.core.wearable

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertSame
import org.junit.Test

class WearPathsTest {

    @Test
    fun `an ordinary stop keeps the usual buzz`() {
        assertSame(WearPaths.PING_BUZZ, WearPaths.pingBuzz("Sudirman"))
        assertSame(WearPaths.WAKE_BUZZ, WearPaths.wakeBuzz("Sudirman"))
    }

    @Test
    fun `manggarai, tanah abang and duri buzz SOS on both reminders`() {
        listOf("Manggarai", "Tanah Abang", "DURI", " Stasiun Duri ").forEach {
            assertArrayEquals(it, SOS_PING, WearPaths.pingBuzz(it))
            assertArrayEquals(it, SOS_WAKE, WearPaths.wakeBuzz(it))
        }
    }

    @Test
    fun `a stop only named like one of them is no easter egg`() {
        assertSame(WearPaths.PING_BUZZ, WearPaths.pingBuzz("Duri Kepa"))
    }

    private companion object {
        // S . . . / O - - - / S . . . on a 100 ms dot: dash 300, symbol gap 100, letter gap 300.
        val SOS_PING = longArrayOf(
            0, 100, 100, 100, 100, 100, 300,
            300, 100, 300, 100, 300, 300,
            100, 100, 100, 100, 100, 700,
        )

        // The same on a 150 ms dot, ending in a 1050 ms word gap.
        val SOS_WAKE = longArrayOf(
            0, 150, 150, 150, 150, 150, 450,
            450, 150, 450, 150, 450, 450,
            150, 150, 150, 150, 150, 1050,
        )
    }
}
