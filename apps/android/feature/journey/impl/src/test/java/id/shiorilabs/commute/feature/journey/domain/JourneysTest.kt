package id.shiorilabs.commute.feature.journey.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class JourneysTest {

    private val sudirmanToLebakBulus = journey(
        ride("KCI:B", "KCI-BOO", "KCI-MRI"),
        ride("KCI:C", "KCI-MRI", "KCI-SUD"),
        walk("KCI-SUD", "MRTJ-DKA", 90),
        ride("MRTJ:M", "MRTJ-DKA", "MRTJ-LBB"),
    )

    @Test
    fun `the journey key names the route's shape, transfers included`() {
        // The same key the web's journeyKey gives the first Bogor to Lebak Bulus option.
        assertEquals("B.BOO-MRI~C.MRI-SUD~_DKA~M.DKA-LBB", journeyKey(sudirmanToLebakBulus))
    }

    @Test
    fun `a key finds its journey, or nothing`() {
        val other = journey(ride("KCI:B", "KCI-BOO", "KCI-JAKK"))
        val journeys = listOf(other, sudirmanToLebakBulus)

        assertEquals(1, findJourneyByKey(journeys, "B.BOO-MRI~C.MRI-SUD~_DKA~M.DKA-LBB"))
        assertNull(findJourneyByKey(journeys, "B.BOO-THB"))
        assertNull(findJourneyByKey(journeys, null))
    }

    @Test
    fun `labels lead with price, whatever order the engine sent`() {
        assertEquals(
            listOf(JourneyLabel.CHEAPEST, JourneyLabel.LEAST_WALKING, JourneyLabel.SHORTEST_WAIT),
            sortJourneyLabels(listOf(JourneyLabel.SHORTEST_WAIT, JourneyLabel.LEAST_WALKING, JourneyLabel.CHEAPEST)),
        )
    }

    @Test
    fun `the boarding lines are the first and last rides, past any walk`() {
        val walkFirst = journey(walk("KCI-SUD", "MRTJ-DKA"), ride("MRTJ:M", "MRTJ-DKA", "MRTJ-LBB"))

        assertEquals(BoardingLines("KCI:B", "MRTJ:M"), boardingLineKeys(sudirmanToLebakBulus))
        assertEquals(BoardingLines("MRTJ:M", "MRTJ:M"), boardingLineKeys(walkFirst))
        assertEquals(BoardingLines(null, null), boardingLineKeys(null))
    }

    @Test
    fun `the route bar sizes rides by distance and keeps only walks between them`() {
        val legs = listOf(
            walk("KCI-SUD", "KCI-SUD2", 50),
            ride("KCI:C", "KCI-SUD2", "KCI-MRI", distanceM = 3000),
            walk("KCI-MRI", "TJ-H1", 0),
            ride("TJ:9", "TJ-H1", "TJ-H2", distanceM = 1000),
            walk("TJ-H2", "MRTJ-SSM", 200),
        )

        val segments = routeBarSegments(legs) { listOf(LegLine(it.line, it.line.substringAfter(':'), "Lin", "#123456", null)) }

        assertEquals(3, segments.size)
        val first = segments[0] as RouteBarSegment.Ride
        assertEquals(0.75, first.share, 1e-9)
        assertEquals("C", first.code)
        // An unmeasured walk is a bare badge, not "0 m".
        assertEquals(RouteBarSegment.Walk(null), segments[1])
        assertEquals("TJ", (segments[2] as RouteBarSegment.Ride).operator)
    }

    @Test
    fun `an unknown line draws grey`() {
        val segments = routeBarSegments(listOf(ride("KCI:Z", "A", "B"))) { emptyList() }

        assertEquals(listOf(LINE_COLOR_FALLBACK), (segments.single() as RouteBarSegment.Ride).colors)
    }

    @Test
    fun `picking the other end's station swaps the pair`() {
        val pair = StationPair("A", "B")

        assertEquals(StationPair("B", "A"), pair.with(PairEnd.ORIGIN, "B"))
        assertEquals(StationPair("B", "A"), pair.with(PairEnd.DESTINATION, "A"))
        assertEquals(StationPair("C", "B"), pair.with(PairEnd.ORIGIN, "C"))
        assertEquals(StationPair("C", null), StationPair().with(PairEnd.ORIGIN, "C"))
    }
}
