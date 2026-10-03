package id.shiorilabs.commute.feature.station.presentation.components

import org.junit.Assert.assertEquals
import org.junit.Test

class PidsChevronsTest {

    @Test
    fun `the chevrons light one after another across the pull`() {
        assertEquals(listOf(0.2f, 0.2f, 0.2f), (0..2).map { litAlpha(0f, it) })
        assertEquals(listOf(1f, 0.2f, 0.2f), (0..2).map { litAlpha(1f / 3, it) })
        assertEquals(0.6f, litAlpha(0.5f, 1), 0.001f)
        assertEquals(listOf(1f, 1f, 1f), (0..2).map { litAlpha(1f, it) })
    }

    @Test
    fun `a pull past the threshold stays fully lit`() {
        assertEquals(listOf(1f, 1f, 1f), (0..2).map { litAlpha(1.4f, it) })
    }
}
