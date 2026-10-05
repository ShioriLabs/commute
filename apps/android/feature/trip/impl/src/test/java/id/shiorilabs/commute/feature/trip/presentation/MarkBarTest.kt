package id.shiorilabs.commute.feature.trip.presentation

import org.junit.Assert.assertEquals
import org.junit.Test

class MarkBarTest {

    @Test
    fun `tandai manual alone is the one row of train marks`() {
        assertEquals(
            listOf(listOf(MarkKind.MOVING, MarkKind.STOPPED, MarkKind.ODD)),
            markRows(manual = true, platform = false),
        )
    }

    @Test
    fun `tandai peron adds the platform row above, keeping the train marks nearest the thumb`() {
        assertEquals(
            listOf(
                listOf(MarkKind.PLATFORM_START, MarkKind.PLATFORM_END),
                listOf(MarkKind.MOVING, MarkKind.STOPPED, MarkKind.ODD),
            ),
            markRows(manual = true, platform = true),
        )
    }

    @Test
    fun `tandai peron alone is just the platform row`() {
        assertEquals(listOf(listOf(MarkKind.PLATFORM_START, MarkKind.PLATFORM_END)), markRows(manual = false, platform = true))
    }

    @Test
    fun `neither switch, no bar`() {
        assertEquals(emptyList<List<MarkKind>>(), markRows(manual = false, platform = false))
    }

    @Test
    fun `platform marks log under their own keys`() {
        assertEquals("platform_start", MarkKind.PLATFORM_START.key)
        assertEquals("platform_end", MarkKind.PLATFORM_END.key)
    }
}
