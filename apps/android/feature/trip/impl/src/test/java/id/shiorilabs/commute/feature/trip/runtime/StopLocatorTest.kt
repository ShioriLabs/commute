package id.shiorilabs.commute.feature.trip.runtime

import id.shiorilabs.commute.core.trip.TripLeg
import id.shiorilabs.commute.core.trip.TripPlan
import id.shiorilabs.commute.core.trip.TripStop
import id.shiorilabs.commute.feature.station.data.StationDirectory
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

class StopLocatorTest {

    private val manggarai = TripStop("KCI-MRI", "Manggarai", -6.2099, 106.8502)
    private val tebet = TripStop("KCI-TEB", "Tebet", -6.2261, 106.8583)
    private val cawang = TripStop("KCI-CW", "Cawang", -6.2427, 106.8588)

    private val plan = TripPlan(listOf(TripLeg.Ride(line = "KCI:C", operator = "KCI", stops = listOf(manggarai, tebet, cawang))))

    /** Every stop already has coordinates, so the directory is never asked. */
    private val unasked = object : StationDirectory {
        override suspend fun all() = error("not asked for placed stops")
    }

    @Test
    fun `a placed plan still gets its hops' shapes, by consecutive station ids`() = runTest {
        val locator = DirectoryStopLocator(unasked) { mapOf("KCI-MRI>KCI-TEB" to "shape-a", "KCI-TEB>KCI-CW" to "shape-b") }

        val placed = locator.place(plan)

        assertEquals(listOf("shape-a", "shape-b"), placed.ride(0).hopShapes)
    }

    @Test
    fun `a hop the shapes don't cover stays straight`() = runTest {
        // One way only: the reverse direction's key is a different hop.
        val locator = DirectoryStopLocator(unasked) { mapOf("KCI-MRI>KCI-TEB" to "shape-a", "KCI-CW>KCI-TEB" to "shape-c") }

        val placed = locator.place(plan)

        assertEquals(listOf("shape-a", null), placed.ride(0).hopShapes)
    }

    @Test
    fun `with no shapes to be had the plan goes through as it came`() = runTest {
        val locator = DirectoryStopLocator(unasked) { null }

        assertEquals(plan, locator.place(plan))
    }
}
