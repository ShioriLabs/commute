package id.shiorilabs.commute.core.trip

import id.shiorilabs.commute.core.geo.GeoPoint
import id.shiorilabs.commute.core.geo.distanceM
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Fixes placed along a hop's real shape rather than the straight line between its stops. */
class TrackShapeTest {

    // Manggarai to Tebet, the track bowed out to a point 1.2 km east of the straight line's midpoint:
    // about 1,070 m off it, past the rail off-route distance, as Batu Ceper to the airport is.
    private val apex = GeoPoint(-6.2180, 106.8651)
    private val straight = TripPlan(listOf(ride(Places.MANGGARAI, Places.TEBET, departs = 0, arrives = 4)))
    private val bowed = straight.shaped(listOf(Places.MANGGARAI.here, apex, Places.TEBET.here))

    // The bow is lopsided: 1.88 km out to its apex, 1.17 km back in.
    private val out = distanceM(Places.MANGGARAI.here, apex)
    private val back = distanceM(apex, Places.TEBET.here)

    @Test
    fun `a train on a bowed hop is placed along the track`() {
        val run = Run(bowed, startAt = at(0))
        run.send(TripEvent.RiderSaid(RiderAction.BOARDED, at(0)))

        run.fix(apex, 1.0, speedMps = 15f)

        assertEquals(PositionSource.CONFIRMED, run.state.source)
        assertEquals(out / (out + back), run.state.confirmedPosition, 0.01)
    }

    @Test
    fun `a train on a bowed hop is placed by the length of track run, not the chord`() {
        val run = Run(bowed, startAt = at(0))
        run.send(TripEvent.RiderSaid(RiderAction.BOARDED, at(0)))

        // Four fifths of the way back in: by the chord's own fraction it would be somewhere else entirely.
        val onTrack = between(TripStop("", "", apex.latitude, apex.longitude), Places.TEBET, 0.8)
        run.fix(onTrack, 2.0, speedMps = 15f)

        assertEquals((out + 0.8 * back) / (out + back), run.state.confirmedPosition, 0.01)
    }

    @Test
    fun `without its shape the same train is taken off its route`() {
        val run = Run(straight, startAt = at(0))
        run.send(TripEvent.RiderSaid(RiderAction.BOARDED, at(0)))

        run.fix(apex, 1.0, speedMps = 15f)
        run.fix(apex, 1.5, speedMps = 15f)
        run.fix(apex, 2.0, speedMps = 15f)

        assertEquals(0.0, run.state.confirmedPosition, 0.0)
        assertTrue(TripEffect.AskStillOnRoute in run.effects)
    }

    @Test
    fun `on its shape the same train is never asked whether it's on its route`() {
        val run = Run(bowed, startAt = at(0))
        run.send(TripEvent.RiderSaid(RiderAction.BOARDED, at(0)))

        run.fix(apex, 1.0, speedMps = 15f)
        run.fix(apex, 1.5, speedMps = 15f)
        run.fix(apex, 2.0, speedMps = 15f)

        assertFalse(TripEffect.AskStillOnRoute in run.effects)
    }

    @Test
    fun `a hop without a shape is still the straight line`() {
        val half = straight.shaped(null)
        val run = Run(half, startAt = at(0))
        run.send(TripEvent.RiderSaid(RiderAction.BOARDED, at(0)))

        run.fix(between(Places.MANGGARAI, Places.TEBET, 0.5), 1.0, speedMps = 15f)

        assertEquals(0.5, run.state.confirmedPosition, 0.01)
    }

    // L13E down Mampang and back along Tendean into Tegal Mampang: the road as a friend's 2026-10-08
    // ride traced it, 1.4 km against the 645 m hop.
    private val mampang = listOf(
        Places.UNDERPASS_KUNINGAN.here,
        GeoPoint(-6.23529, 106.82808),
        GeoPoint(-6.23766, 106.82677),
        GeoPoint(-6.23929, 106.82616),
        GeoPoint(-6.24007, 106.82774),
        GeoPoint(-6.24016, 106.82937),
        Places.TEGAL_MAMPANG.here,
    )

    @Test
    fun `a bus down a road that leaves its straight hop moves on along it`() {
        val run = Run(toCsw.shaped(mampang, null), startAt = at(0))
        run.send(TripEvent.RiderSaid(RiderAction.BOARDED, at(0)))
        run.fix(GeoPoint(-6.23504, 106.82931), 0.63, accuracyM = 11f, speedMps = 2.2f)
        val positions = listOf(
            GeoPoint(-6.23529, 106.82808) to 3.13,
            GeoPoint(-6.23636, 106.82767) to 4.13, GeoPoint(-6.23766, 106.82677) to 5.63,
            GeoPoint(-6.23929, 106.82616) to 7.12, GeoPoint(-6.23997, 106.82658) to 7.62,
        ).map { (point, minutes) ->
            run.fix(point, minutes, accuracyM = 8f, speedMps = 1.5f)
            assertEquals("at $minutes", PositionSource.CONFIRMED, run.state.source)
            run.state.confirmedPosition
        }

        assertEquals(positions.sorted(), positions)
        assertTrue(positions.last() in 0.5..1.0)
        run.fix(GeoPoint(-6.24001, 106.83098), 10.9, accuracyM = 6f, speedMps = 0f)
        assertEquals(1.0, run.state.confirmedPosition, 0.0)
        assertTrue(run.alerts().isEmpty())
    }

    @Test
    fun `a plan stored before shapes were kept still decodes, straight`() {
        val json = Json { ignoreUnknownKeys = true }
        val stored = json.encodeToString(TripPlan.serializer(), straight).replace(",\"hopShapes\":[]", "")

        val plan = json.decodeFromString(TripPlan.serializer(), stored)

        assertEquals(straight, plan)
        assertNull(plan.ride(0).hopPaths[0])
    }

    @Test
    fun `a shaped plan survives being stored`() {
        val json = Json { ignoreUnknownKeys = true }

        val plan = json.decodeFromString(TripPlan.serializer(), json.encodeToString(TripPlan.serializer(), bowed))

        assertEquals(bowed, plan)
        assertEquals(3, plan.ride(0).hopPaths[0]?.size)
    }
}
