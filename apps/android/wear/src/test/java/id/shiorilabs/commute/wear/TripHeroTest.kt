package id.shiorilabs.commute.wear

import id.shiorilabs.commute.core.trip.Headline
import id.shiorilabs.commute.core.trip.PositionSource
import id.shiorilabs.commute.core.trip.TripLeg
import id.shiorilabs.commute.core.trip.TripStop
import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.Instant

class TripHeroTest {

    private val now = Instant.parse("2026-10-04T01:00:00Z")
    private fun inMinutes(minutes: Long) = now.plusSeconds(minutes * 60)

    private val train = ride("KCI:C", "KCI")
    private val bus = ride("TJ:9C", "TJ")

    @Test
    fun `minutes to the train while it is waited for`() {
        assertEquals(Hero.Minutes(4), tripHero(Headline.Board(train, inMinutes(4)), PositionSource.CONFIRMED, now))
        assertEquals(Hero.Minutes(7), tripHero(Headline.Change(train, null, inMinutes(7)), PositionSource.CONFIRMED, now))
    }

    @Test
    fun `the clock for a train an hour or more off, or already due`() {
        assertEquals(Hero.Clock(inMinutes(75)), tripHero(Headline.Board(train, inMinutes(75)), PositionSource.CONFIRMED, now))
        assertEquals(Hero.Clock(inMinutes(-2)), tripHero(Headline.Board(train, inMinutes(-2)), PositionSource.CONFIRMED, now))
    }

    @Test
    fun `the place when there is no time to wait for`() {
        assertEquals(Hero.Place, tripHero(Headline.Board(train, null), PositionSource.CONFIRMED, now))
        assertEquals(Hero.Place, tripHero(Headline.AlightNow(train, null), PositionSource.CONFIRMED, now))
        assertEquals(Hero.Place, tripHero(Headline.Arrived("Bogor"), PositionSource.CONFIRMED, now))
    }

    @Test
    fun `minutes to getting off once aboard`() {
        assertEquals(Hero.Minutes(12), tripHero(Headline.RideTo(train, 3, inMinutes(12)), PositionSource.ESTIMATED, now))
    }

    @Test
    fun `stops left aboard when the time is not known or far`() {
        assertEquals(Hero.StopsLeft(3, bus = false), tripHero(Headline.RideTo(train, 3, null), PositionSource.CONFIRMED, now))
        assertEquals(Hero.StopsLeft(5, bus = true), tripHero(Headline.RideTo(bus, 5, inMinutes(90)), PositionSource.CONFIRMED, now))
        // Nowhere known: the clock can't say when, but the stops still count down.
        assertEquals(Hero.StopsLeft(3, bus = false), tripHero(Headline.RideTo(train, 3, inMinutes(12)), PositionSource.UNKNOWN, now))
    }

    private fun ride(line: String, operator: String) = TripLeg.Ride(
        line = line,
        operator = operator,
        stops = listOf(TripStop("A", "A"), TripStop("B", "B")),
    )
}
