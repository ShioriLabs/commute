package id.shiorilabs.commute.feature.journey.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.OffsetDateTime

/** The web's `saved-route-card/upcoming.test.ts`. */
class UpcomingJourneysTest {

    private fun wib(time: String) = OffsetDateTime.parse("${time}+07:00").toInstant()

    private fun timed(line: String, departure: String) = journey(ride(line, "KCI-A", "KCI-B", departureAt = wib(departure)))

    private fun untimed(line: String) = journey(ride(line, "TJ-A", "TJ-B"))

    private fun ended(resumesAt: String) = untimed("KCI:C").copy(resumesAt = wib(resumesAt))

    private val now = wib("2026-10-01T08:00:00")

    @Test
    fun `timed rows are sorted by boarding time, departed ones dropped`() {
        val rows = upcomingJourneys(
            listOf(
                timed("KCI:B", "2026-10-01T08:20:00"),
                timed("KCI:B", "2026-10-01T07:55:00"),
                timed("KCI:C", "2026-10-01T08:05:00"),
            ),
            now,
        )

        assertEquals(listOf(wib("2026-10-01T08:05:00"), wib("2026-10-01T08:20:00")), rows.map(::boardsAtOf))
    }

    @Test
    fun `untimed journeys follow the timed ones, in the planner's order`() {
        val rows = upcomingJourneys(listOf(untimed("TJ:1"), timed("KCI:B", "2026-10-01T08:20:00"), untimed("TJ:9")), now)

        assertEquals(listOf("KCI:B", "TJ:1", "TJ:9"), rows.map { (it.legs.first() as JourneyLeg.Ride).line })
    }

    @Test
    fun `the list is capped`() {
        val rows = upcomingJourneys(
            listOf(
                timed("KCI:B", "2026-10-01T08:10:00"),
                timed("KCI:B", "2026-10-01T08:20:00"),
                timed("KCI:B", "2026-10-01T08:30:00"),
            ),
            now,
            limit = 2,
        )

        assertEquals(2, rows.size)
    }

    @Test
    fun `a route whose service has ended is not a row, untimed or otherwise`() {
        assertEquals(emptyList<Journey>(), upcomingJourneys(listOf(ended("2026-10-02T04:28:00")), now))
    }

    @Test
    fun `live rows stay beside an ended route`() {
        val live = timed("KCI:B", "2026-10-01T08:20:00")

        assertEquals(listOf(live), upcomingJourneys(listOf(ended("2026-10-02T04:28:00"), live), now))
    }

    @Test
    fun `the earliest restart is the one said`() {
        assertEquals(
            wib("2026-10-02T04:28:00"),
            resumeTimeOf(listOf(ended("2026-10-02T05:10:00"), untimed("TJ:1"), ended("2026-10-02T04:28:00"))),
        )
        assertNull(resumeTimeOf(listOf(untimed("TJ:1"))))
    }
}
