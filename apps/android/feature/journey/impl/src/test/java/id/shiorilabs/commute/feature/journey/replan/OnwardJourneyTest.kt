package id.shiorilabs.commute.feature.journey.replan

import id.shiorilabs.commute.feature.journey.domain.journey
import id.shiorilabs.commute.feature.journey.domain.ride
import id.shiorilabs.commute.feature.journey.domain.walk
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.Instant

class OnwardJourneyTest {

    private fun at(clock: String): Instant = Instant.parse("2026-10-05T${clock}:00Z")

    /** The LRT on from Dukuh Atas, from 10.05. */
    private val ready = at("03:05")

    private val left = journey(ride("LRTJ:BK", "LRTJ-DKA", "LRTJ-STB", departureAt = at("02:59"), arrivalAt = at("03:03")))
        .copy(arrivalAt = at("03:03"))
    private val next = journey(ride("LRTJ:BK", "LRTJ-DKA", "LRTJ-STB", departureAt = at("03:09"), arrivalAt = at("03:13")))
        .copy(arrivalAt = at("03:13"))
    private val other = journey(ride("LRTJ:CB", "LRTJ-DKA", "LRTJ-STB", departureAt = at("03:07"), arrivalAt = at("03:13")))
        .copy(arrivalAt = at("03:13"))
    private val faster = journey(ride("LRTJ:CB", "LRTJ-DKA", "LRTJ-STB", departureAt = at("03:06"), arrivalAt = at("03:10")))
        .copy(arrivalAt = at("03:10"))
    private val walkingFirst = journey(walk("LRTJ-DKA", "MRTJ-DKA"), ride("MRTJ:M", "MRTJ-DKA", "MRTJ-STB", departureAt = at("03:06")))
        .copy(arrivalAt = at("03:08"))

    @Test
    fun `the train that left is passed over for one the rider can still take`() {
        assertEquals(next, onwardJourney(listOf(left, next), "LRTJ-DKA", ready, "LRTJ:BK"))
    }

    @Test
    fun `arriving as soon, the same line wins`() {
        assertEquals(next, onwardJourney(listOf(other, next), "LRTJ-DKA", ready, "LRTJ:BK"))
    }

    @Test
    fun `another line that gets there first wins`() {
        assertEquals(faster, onwardJourney(listOf(next, faster), "LRTJ-DKA", ready, "LRTJ:BK"))
    }

    @Test
    fun `only a ride from where the rider stands will do`() {
        assertNull(onwardJourney(listOf(left, walkingFirst), "LRTJ-DKA", ready, "LRTJ:BK"))
    }
}
