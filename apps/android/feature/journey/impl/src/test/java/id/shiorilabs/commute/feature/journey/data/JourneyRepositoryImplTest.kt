package id.shiorilabs.commute.feature.journey.data

import id.shiorilabs.commute.core.model.models.TripResult
import id.shiorilabs.commute.core.network.testing.FakeCommuteService
import id.shiorilabs.commute.core.type.Failure
import id.shiorilabs.commute.feature.journey.data.impl.JourneyRepositoryImpl
import id.shiorilabs.commute.feature.journey.domain.Departure
import id.shiorilabs.commute.feature.journey.domain.JourneyCriteria
import id.shiorilabs.commute.feature.journey.domain.JourneyLabel
import id.shiorilabs.commute.feature.journey.domain.JourneyLeg
import id.shiorilabs.commute.feature.journey.domain.Modes
import id.shiorilabs.commute.feature.journey.domain.PaymentMethod
import id.shiorilabs.commute.feature.journey.domain.ServiceLine
import id.shiorilabs.commute.feature.journey.domain.WalkingSpeed
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException
import java.time.Clock
import java.time.Instant
import java.time.ZoneId
import java.time.ZoneOffset

/**
 * Against a response captured from the live API (Bogor to Lebak Bulus, Monday 08.00), decoded the
 * way the app decodes it, so this also holds the generated models to what the API sends.
 */
class JourneyRepositoryImplTest {

    private val json = Json { ignoreUnknownKeys = true }

    private val fixture: TripResult by lazy {
        val body = checkNotNull(javaClass.getResource("/trips_multi.json")).readText()
        json.decodeFromJsonElement(json.parseToJsonElement(body).jsonObject.getValue("data"))
    }

    private class MutableClock(var now: Instant) : Clock() {
        override fun getZone(): ZoneId = ZoneOffset.ofHours(7)
        override fun withZone(zone: ZoneId?): Clock = this
        override fun instant(): Instant = now
    }

    private val clock = MutableClock(Instant.parse("2026-10-05T01:00:00Z"))

    private fun service() = FakeCommuteService().apply { trips = { _, _, _ -> fixture } }

    @Test
    fun `every journey maps, labels and all`() = runTest {
        val answer = JourneyRepositoryImpl(service(), clock).trips("KCI-BOO", "MRTJ-LBB", JourneyCriteria()).getOrNull()!!

        assertEquals("Bogor", answer.from.name)
        assertEquals(9, answer.journeys.size)
        assertEquals(listOf(JourneyLabel.LEAST_WALKING), answer.journeys[0].labels)
        assertEquals(listOf(JourneyLabel.CHEAPEST), answer.journeys[3].labels)
        assertEquals(17500, answer.journeys[3].totalFare)
    }

    @Test
    fun `a timed journey carries its clock, an untimed one does not`() = runTest {
        val journeys = JourneyRepositoryImpl(service(), clock).trips("KCI-BOO", "MRTJ-LBB", JourneyCriteria()).getOrNull()!!.journeys

        val timed = journeys[0]
        assertEquals(Instant.parse("2026-10-05T02:49:50Z"), timed.arrivalAt)
        val first = timed.legs.first() as JourneyLeg.Ride
        assertEquals(Instant.parse("2026-10-05T01:03:00Z"), first.departureAt)
        assertEquals("1/2", (timed.legs[1] as JourneyLeg.Ride).platformCode)

        // Through TransJakarta: no arrival, and the bus legs have no times.
        assertNull(journeys[3].arrivalAt)
        assertNull((journeys[3].legs[3] as JourneyLeg.Ride).departureAt)
    }

    @Test
    fun `a leg on shared track keeps every line, and a plain one names its own`() = runTest {
        val journeys = JourneyRepositoryImpl(service(), clock).trips("KCI-BOO", "MRTJ-LBB", JourneyCriteria()).getOrNull()!!.journeys

        assertEquals(3, (journeys[3].legs[3] as JourneyLeg.Ride).serviceLines.size)
        val plain = journeys[0].legs.first() as JourneyLeg.Ride
        assertEquals(listOf(ServiceLine("KCI:B", plain.headsign)), plain.serviceLines)
        val walk = journeys[0].legs[2] as JourneyLeg.Transfer
        assertEquals(90, walk.distanceM)
        assertNull(walk.fare)
    }

    @Test
    fun `only criteria off their defaults are sent`() = runTest {
        var sent: FakeCommuteService.TripCriteria? = null
        val service = FakeCommuteService().apply {
            trips = { _, _, criteria ->
                sent = criteria
                fixture
            }
        }
        val repository = JourneyRepositoryImpl(service, clock)

        repository.trips("KCI-BOO", "MRTJ-LBB", JourneyCriteria())
        assertEquals(FakeCommuteService.TripCriteria(null, null, null, null), sent)

        val at = Instant.parse("2026-10-05T03:20:00Z")
        repository.trips(
            "KCI-BOO",
            "MRTJ-LBB",
            JourneyCriteria(PaymentMethod.QRIS_TAP, Departure.At(at), Modes.RAIL, WalkingSpeed.SLOWEST),
        )
        assertEquals(FakeCommuteService.TripCriteria("QRIS_TAP", "2026-10-05T03:20:00Z", "rail", "SLOWEST"), sent)
    }

    @Test
    fun `an answer for now is reused within its slot and asked again in the next`() = runTest {
        val service = service()
        val repository = JourneyRepositoryImpl(service, clock)

        repository.trips("KCI-BOO", "MRTJ-LBB", JourneyCriteria())
        clock.now = Instant.parse("2026-10-05T01:19:00Z")
        repository.trips("KCI-BOO", "MRTJ-LBB", JourneyCriteria())
        assertEquals(1, service.tripsCalls)

        clock.now = Instant.parse("2026-10-05T01:20:00Z")
        repository.trips("KCI-BOO", "MRTJ-LBB", JourneyCriteria())
        assertEquals(2, service.tripsCalls)
    }

    @Test
    fun `a failure is not cached`() = runTest {
        var fail = true
        val service = FakeCommuteService().apply {
            trips = { _, _, _ -> if (fail) throw IOException("offline") else fixture }
        }
        val repository = JourneyRepositoryImpl(service, clock)

        assertTrue(repository.trips("KCI-BOO", "MRTJ-LBB", JourneyCriteria()).leftOrNull() is Failure.Network)
        fail = false
        assertTrue(repository.trips("KCI-BOO", "MRTJ-LBB", JourneyCriteria()).isRight())
    }
}
