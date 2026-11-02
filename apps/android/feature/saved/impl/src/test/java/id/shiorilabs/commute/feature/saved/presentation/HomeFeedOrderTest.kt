package id.shiorilabs.commute.feature.saved.presentation

import id.shiorilabs.commute.core.type.UIState
import id.shiorilabs.commute.feature.station.domain.StationBoard
import org.junit.Assert.assertEquals
import org.junit.Test

class HomeFeedOrderTest {

    private fun station(id: String) = HomeEntry.StationEntry(StationBoard(id, UIState.Idle, UIState.Idle, null, false))

    private val cakung = station("KCI-CUK")
    private val sudirman = station("KCI-SUD")
    private val toWork = HomeEntry.RouteEntry("KCI-CUK", "KCI-SUD")
    private val home = HomeEntry.RouteEntry("KCI-SUD", "KCI-CUK")
    private val entries = listOf(sudirman, home, cakung, toWork)

    @Test
    fun `nothing near leaves the rider's own order`() {
        assertEquals(RaisedFeed(emptyList(), entries), raiseNearby(entries, emptyList()))
    }

    @Test
    fun `the pairs that start where the rider is come first, then that station`() {
        assertEquals(RaisedFeed(listOf(toWork, cakung), listOf(sudirman, home)), raiseNearby(entries, listOf("KCI-CUK")))
    }

    @Test
    fun `several near ones come nearest first, every pair above every station`() {
        assertEquals(
            RaisedFeed(listOf(toWork, home, cakung, sudirman), emptyList()),
            raiseNearby(entries, listOf("KCI-CUK", "KCI-SUD")),
        )
    }

    @Test
    fun `a pair from the further station still goes above the nearer station's board`() {
        assertEquals(
            RaisedFeed(listOf(home, cakung, sudirman), emptyList()),
            raiseNearby(listOf(cakung, sudirman, home), listOf("KCI-CUK", "KCI-SUD")),
        )
    }

    @Test
    fun `a pair from a near station is raised even when the station itself isn't pinned`() {
        assertEquals(
            RaisedFeed(listOf(toWork), listOf(sudirman, home)),
            raiseNearby(listOf(sudirman, home, toWork), listOf("KCI-CUK")),
        )
    }
}
