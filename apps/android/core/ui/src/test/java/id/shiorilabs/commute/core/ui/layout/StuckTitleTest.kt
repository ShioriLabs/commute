package id.shiorilabs.commute.core.ui.layout

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class StuckTitleTest {

    // Two stations: titles at rows 0 and 2, their cards at rows 1 and 3. Titles are 60 px tall.
    private val titles = listOf(0, 2)
    private val height = 60

    @Test
    fun `at rest the first station's title is the one shown, unmoved`() {
        val stuck = stuckTitle(listOf(TitleSlot(0, 0), TitleSlot(2, 900)), titles, firstVisibleIndex = 0, height)

        assertEquals(StuckTitle(0, 0), stuck)
    }

    @Test
    fun `scrolled into a station's cards, its title stays though its row has gone`() {
        val stuck = stuckTitle(listOf(TitleSlot(2, 500)), titles, firstVisibleIndex = 1, height)

        assertEquals(StuckTitle(0, 0), stuck)
    }

    @Test
    fun `the next title pushes the bar up as it arrives`() {
        val stuck = stuckTitle(listOf(TitleSlot(2, 25)), titles, firstVisibleIndex = 1, height)

        assertEquals(StuckTitle(0, -35), stuck)
    }

    @Test
    fun `once the next title reaches the top, it is the one shown`() {
        val stuck = stuckTitle(listOf(TitleSlot(2, 0)), titles, firstVisibleIndex = 2, height)

        assertEquals(StuckTitle(2, 0), stuck)
    }

    @Test
    fun `an empty feed shows no title`() {
        assertNull(stuckTitle(emptyList(), emptyList(), firstVisibleIndex = 0, height))
    }
}
