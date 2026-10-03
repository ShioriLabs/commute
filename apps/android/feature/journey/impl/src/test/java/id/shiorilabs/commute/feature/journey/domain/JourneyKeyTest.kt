package id.shiorilabs.commute.feature.journey.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.Instant

/** The web's `journey-key.test.ts` cases for a boarding time (`?jt=`). */
class JourneyKeyTest {

    private fun at(iso: String): Instant = Instant.parse(iso)

    // Three boardings of one route, so one key, as a saved pair's rows on home.
    private val rows = listOf("2026-10-01T15:58:00Z", "2026-10-01T16:13:00Z", "2026-10-01T16:21:00Z").map { departure ->
        journey(ride("KCI:C", "KCI-SUD", "KCI-MRI", departureAt = at(departure)))
    }

    @Test
    fun `a boarding time picks that boarding of the route`() {
        assertEquals(2, findJourneyByKey(rows, "C.SUD-MRI", "2321"))
    }

    @Test
    fun `a boarding that has gone falls back to the route's first`() {
        assertEquals(0, findJourneyByKey(rows, "C.SUD-MRI", "2345"))
    }

    @Test
    fun `a boarding is written as WIB wall-clock digits`() {
        assertEquals("2305", boardingClock(at("2026-10-01T16:05:00Z")))
        assertEquals("0010", boardingClock(at("2026-10-01T17:10:00Z")))
    }

    @Test
    fun `a journey boards at its first timed ride`() {
        val untimedFirst = journey(
            ride("TJ:1", "TJ-A", "TJ-B"),
            walk("TJ-B", "KCI-SUD"),
            ride("KCI:C", "KCI-SUD", "KCI-MRI", departureAt = at("2026-10-01T16:05:00Z")),
        )

        assertEquals(at("2026-10-01T16:05:00Z"), boardsAtOf(untimedFirst))
        assertNull(boardsAtOf(journey(ride("TJ:1", "TJ-A", "TJ-B"))))
    }
}
