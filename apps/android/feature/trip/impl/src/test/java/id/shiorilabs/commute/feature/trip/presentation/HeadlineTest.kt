package id.shiorilabs.commute.feature.trip.presentation

import id.shiorilabs.commute.core.trip.Headline
import id.shiorilabs.commute.core.trip.TripEngine
import id.shiorilabs.commute.core.trip.TripLeg
import id.shiorilabs.commute.core.trip.TripPhase
import id.shiorilabs.commute.core.trip.minutesUntil
import id.shiorilabs.commute.feature.trip.ActiveTrip
import id.shiorilabs.commute.feature.trip.NOW
import id.shiorilabs.commute.feature.trip.minutes
import id.shiorilabs.commute.feature.trip.origin
import id.shiorilabs.commute.feature.trip.plan
import org.junit.Assert.assertEquals
import org.junit.Test

class HeadlineTest {

    /** Two minutes before the first train: still waiting for it. */
    private val start = TripEngine.start(plan, NOW.minusSeconds(120), hasLocation = true).state

    @Test
    fun `before the first ride, board it at its time`() {
        assertEquals(Headline.Board(plan.ride(0), minutes(0)), ActiveTrip(plan, start, origin).headline())
    }

    @Test
    fun `after the first ride, change with the walk between`() {
        val changing = ActiveTrip(plan, start.copy(legIndex = 2), origin)
        assertEquals(
            Headline.Change(plan.ride(2), plan.legs[1] as TripLeg.Transfer, minutes(10)),
            changing.headline(),
        )
    }

    @Test
    fun `riding, count the stops left, the alighting one included`() {
        val riding = ActiveTrip(plan, start.copy(legIndex = 2, phase = TripPhase.RIDING, position = 1.4), origin)
        assertEquals(Headline.RideTo(plan.ride(2), stopsLeft = 2, alightsAt = minutes(20)), riding.headline())
    }

    @Test
    fun `at the end of a ride with another to come, say what follows`() {
        val alighting = ActiveTrip(plan, start.copy(phase = TripPhase.RIDING, position = 1.0), origin)
        assertEquals(Headline.AlightNow(plan.ride(0), then = plan.ride(2)), alighting.headline())
    }

    @Test
    fun `minutes round to the nearest, never below one`() {
        assertEquals(2, minutesUntil(NOW, NOW.plusSeconds(100)))
        assertEquals(1, minutesUntil(NOW, NOW.plusSeconds(10)))
        assertEquals(1, minutesUntil(NOW, NOW.minusSeconds(60)))
    }
}
