package id.shiorilabs.commute.feature.trip.runtime

import id.shiorilabs.commute.core.datastore.FakePreferencesDataStore
import id.shiorilabs.commute.core.datastore.LocationPreferencesRepository
import id.shiorilabs.commute.core.geo.GeoPoint
import id.shiorilabs.commute.core.location.Fix
import id.shiorilabs.commute.core.location.testing.FakeLocationClient
import id.shiorilabs.commute.core.trip.AlertKind
import id.shiorilabs.commute.core.trip.FinishReason
import id.shiorilabs.commute.core.trip.PositionSource
import id.shiorilabs.commute.core.trip.RiderAction
import id.shiorilabs.commute.core.trip.TripEffect
import id.shiorilabs.commute.core.trip.TripEngine
import id.shiorilabs.commute.core.trip.TripLeg
import id.shiorilabs.commute.core.trip.TripPhase
import id.shiorilabs.commute.core.trip.TripPlan
import id.shiorilabs.commute.feature.trip.ActiveTrip
import id.shiorilabs.commute.feature.trip.ReplacedPlan
import id.shiorilabs.commute.feature.trip.TripReminder
import id.shiorilabs.commute.feature.trip.CAWANG
import id.shiorilabs.commute.feature.trip.MANGGARAI
import id.shiorilabs.commute.feature.trip.SUDIRMAN
import id.shiorilabs.commute.feature.trip.TEBET
import id.shiorilabs.commute.feature.trip.TripReplanner
import id.shiorilabs.commute.feature.trip.minutes
import id.shiorilabs.commute.feature.trip.DUKUH_ATAS
import id.shiorilabs.commute.feature.trip.NOW
import id.shiorilabs.commute.feature.trip.origin
import id.shiorilabs.commute.feature.trip.plan
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.plus
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.ZoneId
import java.time.ZoneOffset

class TripControllerImplTest {

    private class FakeStore(var trip: ActiveTrip? = null, var finished: FinishedTrip? = null) : TripStore {
        override fun read() = trip
        override fun write(trip: ActiveTrip) {
            this.trip = trip
        }
        override fun clear() {
            trip = null
        }
        override fun readFinished() = finished
        override fun writeFinished(trip: FinishedTrip) {
            finished = trip
        }
        override fun clearFinished() {
            finished = null
        }
    }

    private class FakeRuntime(var trackingAllowed: Boolean = true) : TripRuntime {
        val alerts = mutableListOf<TripEffect.Alert>()
        var progressShown = 0
        var finished = 0
        var tracking = false
        var asked = 0
        var wakeAt: Instant? = null
        val rerouted = mutableListOf<Pair<Int, Instant>>()
        val takenBack = mutableListOf<Int>()
        val reminded = mutableListOf<Pair<Int, TripReminder>>()
        var wakingStopped = 0

        override fun showProgress(trip: ActiveTrip) {
            progressShown++
        }
        override fun alert(trip: ActiveTrip, alert: TripEffect.Alert) {
            alerts += alert
        }
        override fun askStillOnRoute(trip: ActiveTrip) {
            asked++
        }
        override fun rerouted(trip: ActiveTrip, legIndex: Int, missed: Instant) {
            rerouted += legIndex to missed
        }
        override fun rerouteTakenBack(legIndex: Int) {
            takenBack += legIndex
        }
        override fun finish() {
            finished++
        }
        override fun remindRider(trip: ActiveTrip, legIndex: Int) {
            reminded += legIndex to trip.reminder
        }
        override fun stopWakingRider() {
            wakingStopped++
        }
        override fun wakeAt(at: Instant) {
            wakeAt = at
        }
        override fun cancelWake() {
            wakeAt = null
        }
        override fun startTracking(): Boolean {
            tracking = trackingAllowed
            return trackingAllowed
        }
        override fun stopTracking() {
            tracking = false
        }
    }

    private val store = FakeStore()
    private val runtime = FakeRuntime()
    private val location = FakeLocationClient()
    private val locationPreferences = LocationPreferencesRepository(FakePreferencesDataStore())

    /** What the journey planner offers on, and what it was asked. */
    private var onward: TripPlan? = null
    private val asked = mutableListOf<String>()
    /** What the trip logged, by name. */
    private val logged = mutableListOf<String>()
    /** Holds the planner's answer back until completed, for what comes in while it's asked. */
    private var answerHeld: CompletableDeferred<Unit>? = null
    private val replanner = TripReplanner { fromId, toId, _, line ->
        asked += "$fromId>$toId on $line"
        answerHeld?.await()
        onward
    }

    private class MutableClock(var now: Instant) : Clock() {
        override fun instant(): Instant = now
        override fun getZone(): ZoneId = ZoneOffset.UTC
        override fun withZone(zone: ZoneId?): Clock = this
    }

    private fun TestScope.controller(
        at: Instant = NOW,
        scope: CoroutineScope = backgroundScope,
        clock: Clock = Clock.fixed(at, ZoneOffset.UTC),
    ) = TripControllerImpl(
        store = store,
        runtime = runtime,
        locator = { it },
        location = location,
        locationPreferences = locationPreferences,
        replanner = replanner,
        log = { name, _ -> logged += name },
        clock = clock,
        scope = scope,
    )

    @Test
    fun `starting a trip stores it, shows it and starts following the rider`() = runTest {
        val controller = controller()
        runCurrent()

        controller.start(plan, origin)
        runCurrent()

        val trip = controller.active.value!!
        assertEquals(origin, trip.origin)
        assertTrue(trip.state.hasLocation)
        assertEquals(trip, store.trip)
        assertTrue(runtime.tracking)
        assertTrue(runtime.progressShown > 0)
        assertNotNull(runtime.wakeAt)
    }

    @Test
    fun `without location the trip runs on the clock and no service starts`() = runTest {
        location.granted = false
        val controller = controller()
        controller.start(plan, origin)
        runCurrent()

        assertFalse(controller.active.value!!.state.hasLocation)
        assertFalse(runtime.tracking)
    }

    @Test
    fun `with trip fixes off in settings, the trip runs on the clock and no service starts`() = runTest {
        locationPreferences.setTripFixes(false)
        val controller = controller()
        controller.start(plan, origin)
        runCurrent()

        assertFalse(controller.active.value!!.state.hasLocation)
        assertFalse(runtime.tracking)
    }

    @Test
    fun `turned off mid-trip, the trip carries on by the clock, and back on it follows again`() = runTest {
        val controller = controller()
        controller.start(plan, origin)
        runCurrent()
        assertTrue(runtime.tracking)

        locationPreferences.setEnabled(false)
        runCurrent()
        assertFalse(runtime.tracking)
        assertFalse(controller.active.value!!.state.hasLocation)

        locationPreferences.setEnabled(true)
        runCurrent()
        assertTrue(runtime.tracking)
        assertTrue(controller.active.value!!.state.hasLocation)
    }

    @Test
    fun `opening the trip doesn't restart following when settings say no`() = runTest {
        val controller = controller()
        controller.start(plan, origin)
        runCurrent()
        locationPreferences.setTripFixes(false)
        runCurrent()

        controller.resumeTracking()
        runCurrent()

        assertFalse(runtime.tracking)
    }

    @Test
    fun `a service the system refuses leaves the trip on the clock`() = runTest {
        runtime.trackingAllowed = false
        val controller = controller()
        controller.start(plan, origin)
        runCurrent()

        assertFalse(controller.active.value!!.state.hasLocation)
    }

    @Test
    fun `fixes move the trip and its alerts reach the rider`() = runTest {
        val controller = controller()
        controller.start(plan, origin)
        runCurrent()

        controller.onFix(Fix(GeoPoint(DUKUH_ATAS.latitude!!, DUKUH_ATAS.longitude!!), 15f, NOW.plusSeconds(120)))

        assertEquals(AlertKind.ALIGHT, runtime.alerts.last().kind)
        assertFalse(runtime.alerts.last().estimated)
        assertEquals(2, controller.active.value!!.state.legIndex)
        assertEquals(PositionSource.CONFIRMED, controller.active.value!!.state.source)
    }

    @Test
    fun `with a reminder set, getting off brings it too`() = runTest {
        val controller = controller()
        controller.start(plan, origin)
        runCurrent()
        controller.setReminder(TripReminder.WAKE)
        runCurrent()

        controller.onFix(Fix(GeoPoint(DUKUH_ATAS.latitude!!, DUKUH_ATAS.longitude!!), 15f, NOW.plusSeconds(120)))

        assertEquals(listOf(0 to TripReminder.WAKE), runtime.reminded)
        assertEquals(TripReminder.WAKE, store.trip!!.reminder)
    }

    @Test
    fun `without it, getting off is only the notification`() = runTest {
        val controller = controller()
        controller.start(plan, origin)
        runCurrent()

        controller.onFix(Fix(GeoPoint(DUKUH_ATAS.latitude!!, DUKUH_ATAS.longitude!!), 15f, NOW.plusSeconds(120)))

        assertEquals(AlertKind.ALIGHT, runtime.alerts.last().kind)
        assertTrue(runtime.reminded.isEmpty())
    }

    @Test
    fun `getting off, or changing the reminder, stops the alarm`() = runTest {
        val controller = controller()
        controller.start(plan, origin)
        runCurrent()
        controller.setReminder(TripReminder.WAKE)
        runCurrent()

        controller.say(RiderAction.ALIGHTED)
        assertEquals(1, runtime.wakingStopped)

        controller.setReminder(TripReminder.PING)
        runCurrent()
        assertEquals(2, runtime.wakingStopped)
    }

    /** Aboard the 08.00 MRT from Bundaran HI, said to be [lateS] late, but not yet seen on the move. */
    private fun aboardTheMrt(lateS: Long) = ActiveTrip(
        plan,
        TripEngine.start(plan, NOW, hasLocation = true).state.copy(
            phase = TripPhase.RIDING,
            clockOffsetS = lateS,
            source = PositionSource.CONFIRMED,
            confirmedAt = minutes(2),
        ),
        origin,
    )

    private val halfwayToDukuhAtas = GeoPoint((-6.1913 + DUKUH_ATAS.latitude!!) / 2, (106.8230 + DUKUH_ATAS.longitude!!) / 2)

    /** Off the MRT at Dukuh Atas late, at 08.09, with 300 m to walk for the 08.10 from Sudirman. */
    private fun walkingToAMissedTrain() = ActiveTrip(
        plan,
        TripEngine.start(plan, NOW.minusSeconds(120), hasLocation = true).state.copy(
            legIndex = 2,
            phase = TripPhase.WAITING_TO_BOARD,
            confirmedAt = minutes(9),
            walkingSince = minutes(9),
        ),
        origin,
    )

    private val nextTrain = TripLeg.Ride("KCI:B", "KCI", "Manggarai", "2", listOf(SUDIRMAN, MANGGARAI, TEBET, CAWANG), minutes(20), minutes(30))

    @Test
    fun `a train missed at a change is swapped for the next, and the rider told`() = runTest {
        store.trip = walkingToAMissedTrain()
        onward = TripPlan(listOf(nextTrain))
        val controller = controller(at = minutes(13))
        runCurrent()

        assertEquals(listOf("KCI-SUD>KCI-CW on KCI:B"), asked)
        val trip = controller.active.value!!
        assertEquals(plan.legs.take(2), trip.plan.legs.take(2))
        assertEquals(minutes(20), trip.plan.ride(2).departureAt)
        assertEquals(TripPhase.WAITING_TO_BOARD, trip.state.phase)
        assertEquals(listOf(2 to minutes(10)), runtime.rerouted)
        assertEquals(trip.plan, store.trip!!.plan)
    }

    @Test
    fun `a change a late train won't make is re-planned while still aboard it`() = runTest {
        // Seen halfway at 08.06, five minutes late: in at 08.07, at Sudirman about 08.11.30, a minute
        // and a half after the 08.10 has gone.
        onward = TripPlan(listOf(nextTrain))
        store.trip = aboardTheMrt(lateS = 300)
        val controller = controller(at = minutes(6))
        runCurrent()
        controller.onFix(Fix(halfwayToDukuhAtas, 15f, minutes(6), speedMps = 15f))
        runCurrent()

        assertEquals(listOf("KCI-SUD>KCI-CW on KCI:B"), asked)
        val trip = controller.active.value!!
        assertEquals(TripPhase.RIDING, trip.state.phase)
        assertEquals(0, trip.state.legIndex)
        assertEquals(plan.legs.take(2), trip.plan.legs.take(2))
        assertEquals(minutes(20), trip.plan.ride(2).departureAt)
        assertEquals(listOf(2 to minutes(10)), runtime.rerouted)
    }

    /** The MRT to Dukuh Atas taking 40 minutes, 08.00 to 08.40, for the 08.50 from Sudirman. */
    private val longRide = TripPlan(
        listOf(plan.legs[0].let { it as TripLeg.Ride }.copy(arrivalAt = minutes(40)), plan.legs[1], nextTrain.copy(departureAt = minutes(50), arrivalAt = minutes(60))),
    )

    private fun alongTheMrt(fraction: Double) = GeoPoint(
        -6.1913 + (DUKUH_ATAS.latitude!! + 6.1913) * fraction,
        106.8230 + (DUKUH_ATAS.longitude!! - 106.8230) * fraction,
    )

    /** Aboard [longRide], on time when last seen. */
    private fun aboardTheLongRide() = ActiveTrip(
        longRide,
        TripEngine.start(longRide, NOW, hasLocation = true).state.copy(
            phase = TripPhase.RIDING,
            source = PositionSource.CONFIRMED,
            confirmedAt = minutes(2),
        ),
        origin,
    )

    @Test
    fun `a change lost well out is swapped quietly, and told of once near`() = runTest {
        // Halfway at 08.27, seven minutes late: in at 08.47, at Sudirman 08.51.30, past the 08.50.
        store.trip = aboardTheLongRide()
        onward = TripPlan(listOf(nextTrain.copy(departureAt = minutes(60), arrivalAt = minutes(70))))
        val clock = MutableClock(minutes(27))
        val controller = controller(clock = clock)
        runCurrent()
        controller.onFix(Fix(alongTheMrt(0.5), 15f, minutes(27), speedMps = 15f))
        runCurrent()

        val swapped = controller.active.value!!
        assertEquals(minutes(60), swapped.plan.ride(2).departureAt)
        assertEquals(minutes(50), swapped.replaced!!.untold)
        assertEquals(emptyList<Pair<Int, Instant>>(), runtime.rerouted)

        // Three quarters along at 08.38, still late: in within ten minutes, so told, of the 08.50.
        clock.now = minutes(38)
        controller.onFix(Fix(alongTheMrt(0.75), 15f, minutes(38), speedMps = 15f))
        clock.now = minutes(39)
        controller.onFix(Fix(alongTheMrt(0.8), 15f, minutes(39), speedMps = 15f))

        assertEquals(listOf(2 to minutes(50)), runtime.rerouted)
        assertEquals(minutes(60), controller.active.value!!.plan.ride(2).departureAt)
        assertNull(store.trip!!.replaced!!.untold)
    }

    @Test
    fun `a train that makes up the time gets its change back, untold`() = runTest {
        store.trip = aboardTheLongRide()
        onward = TripPlan(listOf(nextTrain.copy(departureAt = minutes(60), arrivalAt = minutes(70))))
        val clock = MutableClock(minutes(27))
        val controller = controller(clock = clock)
        runCurrent()
        controller.onFix(Fix(alongTheMrt(0.5), 15f, minutes(27), speedMps = 15f))
        runCurrent()
        assertEquals(minutes(60), controller.active.value!!.plan.ride(2).departureAt)

        // Three quarters along at 08.31, a minute late: at Sudirman 08.45.30, in time for the 08.50.
        clock.now = minutes(31)
        controller.onFix(Fix(alongTheMrt(0.75), 15f, minutes(31), speedMps = 15f))

        val trip = controller.active.value!!
        assertEquals(longRide, trip.plan)
        assertNull(trip.replaced)
        assertEquals(1, asked.size)
        assertEquals(emptyList<Pair<Int, Instant>>(), runtime.rerouted)
    }

    @Test
    fun `a change made with seconds to spare stays swapped`() = runTest {
        store.trip = aboardTheLongRide()
        onward = TripPlan(listOf(nextTrain.copy(departureAt = minutes(60), arrivalAt = minutes(70))))
        val clock = MutableClock(minutes(27))
        val controller = controller(clock = clock)
        runCurrent()
        controller.onFix(Fix(alongTheMrt(0.5), 15f, minutes(27), speedMps = 15f))
        runCurrent()

        // Seven tenths along at 08.30, two minutes late: at Sudirman 08.42, the walk done about
        // 08.49.30, half a minute before the 08.50. A walk estimate is not good to half a minute.
        clock.now = minutes(30)
        controller.onFix(Fix(alongTheMrt(0.7), 15f, minutes(30), speedMps = 15f))

        val trip = controller.active.value!!
        assertEquals(minutes(60), trip.plan.ride(2).departureAt)
        assertEquals(minutes(50), trip.replaced!!.untold)
    }

    @Test
    fun `a late train still in time for the change isn't re-planned`() = runTest {
        // A minute late: in at 08.03, the walk done by about 08.10.30, inside the minute's grace for the 08.10.
        store.trip = aboardTheMrt(lateS = 60)
        val controller = controller(at = minutes(2))
        runCurrent()
        controller.onFix(Fix(halfwayToDukuhAtas, 15f, minutes(2), speedMps = 15f))
        runCurrent()

        assertEquals(0, controller.active.value!!.state.legIndex)
        assertEquals(emptyList<String>(), asked)
    }

    @Test
    fun `lateness only the boarding tap suggests doesn't re-plan ahead`() = runTest {
        // "Udah naik" at 08.06 for the 08.00: the train may have run late, or the tap did. No fix
        // has seen it on the move yet.
        store.trip = aboardTheMrt(lateS = 360)
        val controller = controller(at = minutes(6))
        runCurrent()

        assertEquals(0, controller.active.value!!.state.legIndex)
        assertEquals(emptyList<String>(), asked)
    }

    /** On Sudirman's platform for the 08.10, seen there a minute after it was due. */
    private fun onThePlatform() = ActiveTrip(
        plan,
        TripEngine.start(plan, NOW, hasLocation = true).state.copy(
            legIndex = 2,
            phase = TripPhase.WAITING_TO_BOARD,
            source = PositionSource.CONFIRMED,
            confirmedAt = minutes(11),
            sightedPosition = 0.0,
        ),
        origin,
    )

    private fun sudirmanToManggarai(fraction: Double) = GeoPoint(
        SUDIRMAN.latitude!! + (MANGGARAI.latitude!! - SUDIRMAN.latitude!!) * fraction,
        SUDIRMAN.longitude!! + (MANGGARAI.longitude!! - SUDIRMAN.longitude!!) * fraction,
    )

    @Test
    fun `a train past its time while the rider waits on its platform is swapped for the next, quietly`() = runTest {
        store.trip = onThePlatform()
        onward = TripPlan(listOf(nextTrain))
        val controller = controller(at = minutes(11).plusSeconds(30))
        runCurrent()

        assertEquals(minutes(20), controller.active.value!!.plan.ride(2).departureAt)
        assertEquals(emptyList<Pair<Int, Instant>>(), runtime.rerouted)
    }

    @Test
    fun `seen aboard before the next train could have left, the rider is on the late one it replaced`() = runTest {
        store.trip = onThePlatform()
        onward = TripPlan(listOf(nextTrain))
        val controller = controller(at = minutes(11).plusSeconds(30))
        runCurrent()

        // The 08.10, three minutes late: 600 m out at 08.13.
        controller.onFix(Fix(sudirmanToManggarai(0.2), 10f, minutes(13), speedMps = 12f))
        controller.onFix(Fix(sudirmanToManggarai(0.22), 10f, minutes(13).plusSeconds(5), speedMps = 12f))

        val trip = controller.active.value!!
        assertEquals(plan, trip.plan)
        assertEquals(TripPhase.RIDING, trip.state.phase)
        // Late against the 08.10, not pinned early against the 08.20.
        assertTrue(trip.state.clockOffsetS in 60L..240L)
        assertNull(trip.replaced)
    }

    @Test
    fun `swapped twice, the rider seen aboard early is on the train swapped last, not the first`() = runTest {
        // The 08.10 already swapped for the 08.20; on the platform still at 08.21.30, that one's
        // swapped for the 08.30.
        val afterOne = TripPlan(plan.legs.take(2) + nextTrain)
        val waiting = onThePlatform()
        store.trip = waiting.copy(
            plan = afterOne,
            state = waiting.state.copy(confirmedAt = minutes(21)),
            replaced = ReplacedPlan(plan, 2),
        )
        onward = TripPlan(listOf(nextTrain.copy(departureAt = minutes(30), arrivalAt = minutes(40))))
        val controller = controller(at = minutes(21).plusSeconds(30))
        runCurrent()
        assertEquals(minutes(30), controller.active.value!!.plan.ride(2).departureAt)

        // The 08.20, three minutes late: 600 m out at 08.23.
        controller.onFix(Fix(sudirmanToManggarai(0.2), 10f, minutes(23), speedMps = 12f))
        controller.onFix(Fix(sudirmanToManggarai(0.22), 10f, minutes(23).plusSeconds(5), speedMps = 12f))

        val trip = controller.active.value!!
        assertEquals(afterOne, trip.plan)
        assertEquals(TripPhase.RIDING, trip.state.phase)
        // Late against the 08.20, not thirteen minutes against the 08.10.
        assertTrue(trip.state.clockOffsetS in 60L..240L)
        assertNull(trip.replaced)
    }

    @Test
    fun `boarding before the next train by a tap takes back the late one too`() = runTest {
        store.trip = onThePlatform()
        onward = TripPlan(listOf(nextTrain))
        val controller = controller(at = minutes(13))
        runCurrent()

        controller.say(RiderAction.BOARDED)

        assertEquals(plan, controller.active.value!!.plan)
    }

    @Test
    fun `seen aboard when the next train leaves, the rider is on it`() = runTest {
        store.trip = onThePlatform()
        onward = TripPlan(listOf(nextTrain))
        val controller = controller(at = minutes(11).plusSeconds(30))
        runCurrent()

        controller.onFix(Fix(GeoPoint(SUDIRMAN.latitude!!, SUDIRMAN.longitude!!), 10f, minutes(20), speedMps = 0f))
        controller.onFix(Fix(sudirmanToManggarai(0.2), 10f, minutes(21), speedMps = 12f))
        controller.onFix(Fix(sudirmanToManggarai(0.22), 10f, minutes(21).plusSeconds(5), speedMps = 12f))

        val trip = controller.active.value!!
        assertEquals(minutes(20), trip.plan.ride(2).departureAt)
        assertEquals(TripPhase.RIDING, trip.state.phase)
        assertNull(trip.replaced)
    }

    /**
     * The 08.20 with a timetable padded like 5152C's on 16 Oct: ten minutes' run to Manggarai, due
     * there at 08.28, where the 08.10 is due about 08.14.
     */
    private val paddedNextTrain = nextTrain.copy(
        stops = listOf(SUDIRMAN, MANGGARAI.copy(scheduledAt = minutes(28)), TEBET.copy(scheduledAt = minutes(30)), CAWANG),
        arrivalAt = minutes(33),
    )

    private fun manggaraiToTebet(fraction: Double) = GeoPoint(
        MANGGARAI.latitude!! + (TEBET.latitude!! - MANGGARAI.latitude!!) * fraction,
        MANGGARAI.longitude!! + (TEBET.longitude!! - MANGGARAI.longitude!!) * fraction,
    )

    @Test
    fun `a train that leaves a station well before the one swapped in could is the late one it replaced`() = runTest {
        // As at Sudirman on 16 Oct: the 08.10 swapped for the 08.20 on the platform, then pulling
        // out at 08.19.45, ten minutes late, when the 08.20 was due. Nothing yet tells them apart.
        store.trip = onThePlatform()
        onward = TripPlan(listOf(paddedNextTrain))
        val controller = controller(at = minutes(11).plusSeconds(30))
        runCurrent()
        controller.onFix(Fix(GeoPoint(SUDIRMAN.latitude!!, SUDIRMAN.longitude!!), 10f, minutes(19).plusSeconds(30), speedMps = 0f))
        controller.onFix(Fix(sudirmanToManggarai(0.05), 10f, minutes(19).plusSeconds(50), speedMps = 6f))
        controller.onFix(Fix(sudirmanToManggarai(0.07), 10f, minutes(19).plusSeconds(55), speedMps = 8f))
        controller.active.value!!.let {
            assertEquals(minutes(20), it.plan.ride(2).departureAt)
            assertEquals(TripPhase.RIDING, it.state.phase)
        }

        // Out of Manggarai at 08.24, four minutes before the 08.20 is due there: not the 08.20.
        controller.onFix(Fix(GeoPoint(MANGGARAI.latitude!!, MANGGARAI.longitude!!), 10f, minutes(23), speedMps = 0f))
        controller.onFix(Fix(GeoPoint(MANGGARAI.latitude!!, MANGGARAI.longitude!!), 10f, minutes(24), speedMps = 0f))
        controller.onFix(Fix(manggaraiToTebet(0.2), 10f, minutes(24).plusSeconds(30), speedMps = 12f))

        val trip = controller.active.value!!
        assertEquals(plan, trip.plan)
        assertEquals(TripPhase.RIDING, trip.state.phase)
        // Late against the 08.10, not pinned early against the 08.20.
        assertTrue(trip.state.clockOffsetS in 400L..800L)
    }

    @Test
    fun `a swapped-in train that waits out its time at a station is the one ridden`() = runTest {
        // The 08.20 itself, on time: in at Manggarai early, held there until it's due at 08.28.
        store.trip = onThePlatform()
        onward = TripPlan(listOf(paddedNextTrain))
        val controller = controller(at = minutes(11).plusSeconds(30))
        runCurrent()
        controller.onFix(Fix(GeoPoint(SUDIRMAN.latitude!!, SUDIRMAN.longitude!!), 10f, minutes(19).plusSeconds(50), speedMps = 0f))
        controller.onFix(Fix(sudirmanToManggarai(0.05), 10f, minutes(20).plusSeconds(10), speedMps = 6f))
        controller.onFix(Fix(sudirmanToManggarai(0.07), 10f, minutes(20).plusSeconds(15), speedMps = 8f))
        assertEquals(TripPhase.RIDING, controller.active.value!!.state.phase)
        controller.onFix(Fix(GeoPoint(MANGGARAI.latitude!!, MANGGARAI.longitude!!), 10f, minutes(23), speedMps = 0f))
        controller.onFix(Fix(GeoPoint(MANGGARAI.latitude!!, MANGGARAI.longitude!!), 10f, minutes(28), speedMps = 0f))
        controller.onFix(Fix(manggaraiToTebet(0.2), 10f, minutes(28).plusSeconds(30), speedMps = 12f))

        val trip = controller.active.value!!
        assertEquals(minutes(20), trip.plan.ride(2).departureAt)
        assertEquals(TripPhase.RIDING, trip.state.phase)
    }


    /** [onThePlatform], seen there at 08.10.50, before the 08.10 was a minute late. */
    private fun onThePlatformInTime(): ActiveTrip = onThePlatform().let {
        it.copy(state = it.state.copy(confirmedAt = minutes(10).plusSeconds(50)))
    }

    @Test
    fun `a train seen pulling out isn't given up on before the next fix can say the rider is aboard`() = runTest {
        // The 08.10 leaving late, as at Setiabudi on 15 Oct: 300 m out at 08.11.19, past the minute's
        // grace, one fix of the two boarding asks for. The next is half a minute off.
        store.trip = onThePlatformInTime()
        onward = TripPlan(listOf(nextTrain))
        val clock = MutableClock(minutes(10).plusSeconds(50))
        val controller = controller(clock = clock)
        runCurrent()

        clock.now = minutes(11).plusSeconds(19)
        controller.onFix(Fix(sudirmanToManggarai(0.1), 7f, clock.now, speedMps = 4.5f))
        runCurrent()

        assertEquals(emptyList<String>(), asked)
        assertEquals(emptyList<Pair<Int, Instant>>(), runtime.rerouted)

        clock.now = minutes(11).plusSeconds(49)
        controller.onFix(Fix(sudirmanToManggarai(0.2), 6f, clock.now, speedMps = 7.5f))
        runCurrent()

        val trip = controller.active.value!!
        assertEquals(plan, trip.plan)
        assertEquals(TripPhase.RIDING, trip.state.phase)
        assertEquals(emptyList<String>(), asked)
    }

    @Test
    fun `a train seen leaving while its re-plan is asked keeps the rider, unless the next fix says not`() = runTest {
        store.trip = onThePlatformInTime()
        onward = TripPlan(listOf(nextTrain))
        answerHeld = CompletableDeferred()
        val clock = MutableClock(minutes(10).plusSeconds(50))
        val controller = controller(clock = clock)
        runCurrent()

        // Still standing there at 08.11.05: the 08.10 is asked about.
        clock.now = minutes(11).plusSeconds(5)
        controller.onFix(Fix(GeoPoint(SUDIRMAN.latitude!!, SUDIRMAN.longitude!!), 7f, clock.now, speedMps = 0f))
        runCurrent()
        assertEquals(1, asked.size)

        // Seen leaving before the answer: the swap waits on the next fix.
        clock.now = minutes(11).plusSeconds(19)
        controller.onFix(Fix(sudirmanToManggarai(0.1), 7f, clock.now, speedMps = 4.5f))
        answerHeld!!.complete(Unit)
        answerHeld = null
        runCurrent()
        assertEquals(plan, controller.active.value!!.plan)
        assertEquals(emptyList<Pair<Int, Instant>>(), runtime.rerouted)

        // Which has them back on the platform: a fix that leapt. Gone after all, so asked again.
        clock.now = minutes(11).plusSeconds(49)
        controller.onFix(Fix(GeoPoint(SUDIRMAN.latitude!!, SUDIRMAN.longitude!!), 6f, clock.now, speedMps = 0f))
        runCurrent()
        assertEquals(2, asked.size)
        assertEquals(minutes(20), controller.active.value!!.plan.ride(2).departureAt)
    }

    @Test
    fun `a train past its time rolling out along the platform is swapped for the next, quietly`() = runTest {
        // At 08.11.05, 90 m along at 11 m/s, still within the platform: the rider is on it or still
        // standing there, as at Sudirman on 15 Oct. Neither needs telling.
        store.trip = onThePlatformInTime()
        onward = TripPlan(listOf(nextTrain))
        val clock = MutableClock(minutes(10).plusSeconds(50))
        val controller = controller(clock = clock)
        runCurrent()

        clock.now = minutes(11).plusSeconds(5)
        controller.onFix(Fix(sudirmanToManggarai(0.03), 8f, clock.now, speedMps = 11f))
        runCurrent()

        assertEquals(minutes(20), controller.active.value!!.plan.ride(2).departureAt)
        assertEquals(emptyList<Pair<Int, Instant>>(), runtime.rerouted)
    }

    @Test
    fun `a swap the rider was told of is taken back with the train, once seen aboard it after all`() = runTest {
        store.trip = walkingToAMissedTrain()
        onward = TripPlan(listOf(nextTrain))
        val controller = controller(at = minutes(13))
        runCurrent()
        assertEquals(listOf(2 to minutes(10)), runtime.rerouted)

        // Ran for it and made it: the 08.10, three minutes late, a kilometre out at 08.13.30.
        controller.onFix(Fix(sudirmanToManggarai(0.33), 10f, minutes(13).plusSeconds(30), speedMps = 12f))
        controller.onFix(Fix(sudirmanToManggarai(0.35), 10f, minutes(13).plusSeconds(35), speedMps = 12f))
        controller.onFix(Fix(sudirmanToManggarai(0.37), 10f, minutes(13).plusSeconds(40), speedMps = 12f))

        val trip = controller.active.value!!
        assertEquals(plan, trip.plan)
        assertEquals(TripPhase.RIDING, trip.state.phase)
        assertEquals(listOf(2), runtime.takenBack)
    }

    @Test
    fun `nothing on offer leaves the trip as it was`() = runTest {
        store.trip = walkingToAMissedTrain()
        val controller = controller(at = minutes(13))
        runCurrent()

        assertEquals(1, asked.size)
        assertEquals(plan, controller.active.value!!.plan)
        assertEquals(emptyList<Instant>(), runtime.rerouted)
    }

    @Test
    fun `nothing on offer is asked again after a while, with no fix to step on`() = runTest {
        store.trip = walkingToAMissedTrain()
        val clock = MutableClock(minutes(13))
        val controller = controller(clock = clock)
        runCurrent()
        assertEquals(1, asked.size)

        // Back online, the rider still on their way: nothing else steps the trip.
        onward = TripPlan(listOf(nextTrain))
        clock.now = minutes(16)
        testScheduler.advanceTimeBy(Duration.ofMinutes(2).toMillis() + 1)
        runCurrent()

        assertEquals(2, asked.size)
        assertEquals(minutes(20), controller.active.value!!.plan.ride(2).departureAt)
    }

    @Test
    fun `nothing on offer is asked again by an alarm too, for a process that is frozen meanwhile`() = runTest {
        store.trip = walkingToAMissedTrain()
        controller(at = minutes(13))
        runCurrent()

        assertEquals(1, asked.size)
        assertEquals(minutes(15), runtime.wakeAt)
    }

    @Test
    fun `a rider still walking once the grace for the train is out is re-planned, with no fix to say so`() = runTest {
        // Off at 08.02.58 for the 08.10 with 300 m to walk: done about 08.10.30, inside the minute's
        // grace, so not missed yet. This is the 19 Oct stretch with no fixes and no events.
        val early = walkingToAMissedTrain()
        val offAt = minutes(2).plusSeconds(58)
        store.trip = early.copy(state = early.state.copy(confirmedAt = offAt, walkingSince = offAt))
        onward = TripPlan(listOf(nextTrain))
        val clock = MutableClock(minutes(5))
        val controller = controller(clock = clock)
        runCurrent()
        assertEquals(emptyList<String>(), asked)

        clock.now = minutes(10).plusSeconds(1)
        controller.tick()
        runCurrent()
        assertEquals(emptyList<String>(), asked)
        assertEquals(minutes(11).plusSeconds(1), runtime.wakeAt)

        // The wake is all that comes: the walk is past its time, and the train has gone.
        clock.now = minutes(11).plusSeconds(1)
        testScheduler.advanceTimeBy(Duration.ofSeconds(60).toMillis())
        runCurrent()

        assertEquals(listOf("KCI-SUD>KCI-CW on KCI:B"), asked)
        assertEquals(minutes(20), controller.active.value!!.plan.ride(2).departureAt)
    }

    @Test
    fun `the alarm's tick can wait for the re-plan it started`() = runTest {
        store.trip = walkingToAMissedTrain()
        onward = TripPlan(listOf(nextTrain))
        answerHeld = CompletableDeferred()
        val controller = controller(at = minutes(13))
        runCurrent()
        assertEquals(1, asked.size)

        var waited = false
        backgroundScope.launch {
            controller.awaitReplan(Duration.ofSeconds(30))
            waited = true
        }
        runCurrent()
        assertFalse(waited)
        assertEquals(plan, controller.active.value!!.plan)

        answerHeld!!.complete(Unit)
        answerHeld = null
        runCurrent()
        assertTrue(waited)
        assertEquals(minutes(20), controller.active.value!!.plan.ride(2).departureAt)
    }

    @Test
    fun `waiting for a re-plan that never answers gives up, with the trip as it was`() = runTest {
        store.trip = walkingToAMissedTrain()
        answerHeld = CompletableDeferred()
        val controller = controller(at = minutes(13))
        runCurrent()

        var waited = false
        backgroundScope.launch {
            controller.awaitReplan(Duration.ofSeconds(30))
            waited = true
        }
        testScheduler.advanceTimeBy(29_000)
        runCurrent()
        assertFalse(waited)

        testScheduler.advanceTimeBy(2_000)
        runCurrent()
        assertTrue(waited)
        assertEquals(plan, controller.active.value!!.plan)
    }

    @Test
    fun `a re-plan being asked, and a trip picked up again, are logged`() = runTest {
        store.trip = walkingToAMissedTrain()
        controller(at = minutes(13))
        runCurrent()

        assertTrue("restored" in logged)
        assertTrue("resumed" in logged)
        assertTrue("replan" in logged)
    }

    @Test
    fun `tracking that can't be started again is logged`() = runTest {
        store.trip = walkingToAMissedTrain()
        runtime.trackingAllowed = false
        controller(at = minutes(13))
        runCurrent()

        assertTrue("tracking" in logged)
    }

    /**
     * Still walking to the 08.10 (the walk is not done by it, so the clock leaves the rider waiting),
     * with the 08.14 and 08.18 behind it, as the API named them.
     */
    private fun waitingForTheEightTen(): ActiveTrip {
        val ride = (plan.legs[2] as TripLeg.Ride).copy(nextDepartures = listOf(minutes(14), minutes(18)))
        return walkingToAMissedTrain().let { it.copy(plan = TripPlan(plan.legs.take(2) + ride)) }
    }

    @Test
    fun `boarding when a later train was due is that train, however late the planned one would be`() = runTest {
        // 19 Oct: the 10.17 LRT planned, "Udah naik" at 10.21.42 with the 10.21 listed behind it.
        store.trip = waitingForTheEightTen()
        val clock = MutableClock(minutes(14).plusSeconds(42))
        val controller = controller(clock = clock)
        runCurrent()

        controller.say(RiderAction.BOARDED)

        val trip = controller.active.value!!
        val ride = trip.plan.ride(2)
        assertEquals(TripPhase.RIDING, trip.state.phase)
        assertEquals(minutes(14), ride.departureAt)
        assertEquals(minutes(24), ride.arrivalAt)
        assertEquals(listOf(minutes(18)), ride.nextDepartures)
        assertEquals(42L, trip.state.clockOffsetS)
        assertTrue("later" in logged)
    }

    @Test
    fun `boarding a little after the planned train is that train, running late`() = runTest {
        store.trip = waitingForTheEightTen()
        val clock = MutableClock(minutes(11).plusSeconds(30))
        val controller = controller(clock = clock)
        runCurrent()

        controller.say(RiderAction.BOARDED)

        val trip = controller.active.value!!
        assertEquals(minutes(10), trip.plan.ride(2).departureAt)
        assertEquals(90L, trip.state.clockOffsetS)
        assertFalse("later" in logged)
    }

    @Test
    fun `boarding a few seconds ahead of a later train's time is that train, boarded early`() = runTest {
        store.trip = waitingForTheEightTen()
        val clock = MutableClock(minutes(13).plusSeconds(45))
        val controller = controller(clock = clock)
        runCurrent()

        controller.say(RiderAction.BOARDED)

        val trip = controller.active.value!!
        assertEquals(minutes(14), trip.plan.ride(2).departureAt)
        // Before its time, the engine reads a tap as on time.
        assertEquals(0L, trip.state.clockOffsetS)
    }

    @Test
    fun `boarding a minute before a later train is due is the planned train, running late`() = runTest {
        // 3 minutes late on the 08.10, tapped at 08.13 with the 08.14 listed: a train does not leave a
        // minute early, so this is the 08.10, and its lateness is kept.
        store.trip = waitingForTheEightTen()
        val clock = MutableClock(minutes(13))
        val controller = controller(clock = clock)
        runCurrent()

        controller.say(RiderAction.BOARDED)

        val trip = controller.active.value!!
        assertEquals(minutes(10), trip.plan.ride(2).departureAt)
        assertEquals(180L, trip.state.clockOffsetS)
    }

    @Test
    fun `a swap already made is not moved again by a late boarding`() = runTest {
        // Swapped for the 08.10 and boarding at 08.14.42: boardedEarlier keeps the swapped plan and
        // leaves it "either train" for leftTooEarly to settle; moving the leg here would drop that.
        val waiting = waitingForTheEightTen()
        store.trip = waiting.copy(replaced = ReplacedPlan(waiting.plan, 2, null))
        val clock = MutableClock(minutes(14).plusSeconds(42))
        val controller = controller(clock = clock)
        runCurrent()

        controller.say(RiderAction.BOARDED)

        val trip = controller.active.value!!
        assertEquals(minutes(10), trip.plan.ride(2).departureAt)
        assertNotNull(trip.mightBeOn)
        assertFalse("later" in logged)
    }

    @Test
    fun `the clock boarding a rider late is not a boarding of a later train`() = runTest {
        // A late alarm, a restore, a stale fix: the tick that finds the planned train gone boards by the
        // clock, at whatever moment it ran. That says nothing about which train the rider is on.
        val waiting = waitingForTheEightTen()
        store.trip = waiting.copy(state = waiting.state.copy(confirmedAt = null, walkingSince = null))
        val clock = MutableClock(minutes(9))
        val controller = controller(clock = clock)
        runCurrent()
        assertEquals(TripPhase.WAITING_TO_BOARD, controller.active.value!!.state.phase)

        // The alarm for the 08.10 comes at 08.13.50, in Doze.
        clock.now = minutes(13).plusSeconds(50)
        controller.tick()

        val trip = controller.active.value!!
        assertEquals(TripPhase.RIDING, trip.state.phase)
        assertEquals(minutes(10), trip.plan.ride(2).departureAt)
    }

    /** The MRT in at 08.05 for the 08.10 from Sudirman across 300 m: five minutes to change, planned. */
    private val tightChange = TripPlan(
        listOf((plan.legs[0] as TripLeg.Ride).copy(arrivalAt = minutes(5)), plan.legs[1], plan.legs[2]),
    )

    private fun aboardTheTightMrt() = ActiveTrip(
        tightChange,
        TripEngine.start(tightChange, NOW, hasLocation = true).state.copy(
            phase = TripPhase.RIDING,
            source = PositionSource.CONFIRMED,
            confirmedAt = minutes(2),
        ),
        origin,
    )

    @Test
    fun `an on-time train into a change the planner allows isn't re-planned for the walk's stairs`() = runTest {
        // 300 m is 272 s at an easy pace and 180 s of stairs more; the plan gave 300 s. On time, the
        // change was the planner's to approve, not a miss.
        store.trip = aboardTheTightMrt()
        val controller = controller(at = minutes(3))
        runCurrent()
        controller.onFix(Fix(halfwayToDukuhAtas, 15f, minutes(3), speedMps = 15f))
        runCurrent()

        assertEquals(emptyList<String>(), asked)
        assertEquals(tightChange, controller.active.value!!.plan)
    }

    @Test
    fun `a train more than a minute late into that change is re-planned`() = runTest {
        // Halfway at 08.04.30 for 08.02.30: two minutes late.
        store.trip = aboardTheTightMrt()
        val controller = controller(at = minutes(4).plusSeconds(30))
        runCurrent()
        controller.onFix(Fix(halfwayToDukuhAtas, 15f, minutes(4).plusSeconds(30), speedMps = 15f))
        runCurrent()

        assertEquals(1, asked.size)
    }

    @Test
    fun `a re-plan that finds nothing after the trip has ended arms no wake`() = runTest {
        store.trip = walkingToAMissedTrain()
        answerHeld = CompletableDeferred()
        val controller = controller(at = minutes(13))
        runCurrent()
        assertEquals(1, asked.size)

        controller.stop()
        runCurrent()
        assertNull(controller.active.value)
        assertNull(runtime.wakeAt)

        answerHeld!!.complete(Unit)
        answerHeld = null
        runCurrent()

        assertNull(runtime.wakeAt)
    }

    @Test
    fun `a train that left late, seen only near the next stop, is the planned train and not a later one`() = runTest {
        // The 08.10 leaves a minute late; the first fixes that see the rider aboard are at Manggarai at
        // 08.14.10, after the 08.14 has left Sudirman. The fix's time is not the boarding's.
        val waiting = waitingForTheEightTen()
        // Seen on the platform at 08.10.50, then no fix until Manggarai.
        store.trip = waiting.copy(
            state = waiting.state.copy(confirmedAt = minutes(10).plusSeconds(50), walkingSince = null, sightedPosition = 0.0),
        )
        val clock = MutableClock(minutes(10).plusSeconds(50))
        val controller = controller(clock = clock)
        runCurrent()
        assertEquals(TripPhase.WAITING_TO_BOARD, controller.active.value!!.state.phase)

        clock.now = minutes(14).plusSeconds(10)
        controller.onFix(Fix(GeoPoint(MANGGARAI.latitude!!, MANGGARAI.longitude!!), 10f, clock.now, speedMps = 12f))
        clock.now = minutes(14).plusSeconds(20)
        val past = GeoPoint(
            MANGGARAI.latitude!! + (TEBET.latitude!! - MANGGARAI.latitude!!) * 0.05,
            MANGGARAI.longitude!! + (TEBET.longitude!! - MANGGARAI.longitude!!) * 0.05,
        )
        controller.onFix(Fix(past, 10f, clock.now, speedMps = 12f))
        runCurrent()

        val trip = controller.active.value!!
        assertEquals(trip.state.toString(), TripPhase.RIDING, trip.state.phase)
        assertEquals(minutes(10), trip.plan.ride(2).departureAt)
        assertFalse("later" in logged)
    }

    @Test
    fun `a train still to be caught isn't re-planned`() = runTest {
        // Off at 08.02 instead: there in good time for the 08.10, which is just leaving.
        val early = walkingToAMissedTrain()
        store.trip = early.copy(state = early.state.copy(confirmedAt = minutes(2), walkingSince = minutes(2)))
        controller(at = minutes(10))
        runCurrent()

        assertEquals(emptyList<String>(), asked)
    }

    @Test
    fun `stopping clears everything the trip left behind`() = runTest {
        val controller = controller()
        controller.start(plan, origin)
        runCurrent()

        controller.say(RiderAction.STOP)

        assertNull(controller.active.value)
        assertNull(store.trip)
        assertNull(runtime.wakeAt)
        assertFalse(runtime.tracking)
        assertEquals(1, runtime.finished)
    }

    @Test
    fun `a trip that ends is kept, with how it ended, until the next starts`() = runTest {
        val controller = controller()
        controller.start(plan, origin)
        runCurrent()
        val last = controller.active.value!!

        controller.say(RiderAction.STOP)

        val finished = controller.finished.value!!
        assertEquals(FinishReason.STOPPED, finished.reason)
        assertEquals(last.plan, finished.trip.plan)
        assertEquals(NOW, finished.at)
        assertEquals(finished, store.finished)

        controller.start(plan, origin)
        runCurrent()
        assertNull(controller.finished.value)
        assertNull(store.finished)
    }

    @Test
    fun `an ended trip comes back after the process died, but not the next day`() = runTest {
        controller().apply {
            start(plan, origin)
            runCurrent()
            say(RiderAction.STOP)
        }
        val stored = store.finished!!

        val soon = controller(NOW.plusSeconds(3_600))
        runCurrent()
        assertEquals(stored, soon.finished.value)

        val tomorrow = controller(NOW.plusSeconds(86_400))
        runCurrent()
        assertNull(tomorrow.finished.value)
    }

    @Test
    fun `a stored trip picks up after the process died, as an estimate`() = runTest {
        val started = TripEngine.start(plan, NOW, hasLocation = true)
        store.trip = ActiveTrip(plan, started.state, origin)

        val controller = controller(at = NOW.plusSeconds(60))
        runCurrent()

        val trip = controller.active.value!!
        assertTrue(trip.state.resumed)
        assertEquals(TripPhase.RIDING, trip.state.phase)
        assertEquals(PositionSource.ESTIMATED, trip.state.source)
        // From the foreground, location tracking starts again.
        assertTrue(runtime.tracking)
    }

    @Test
    fun `a stored trip that ran out while the app was dead ends on restore`() = runTest {
        val started = TripEngine.start(plan, NOW, hasLocation = false)
        store.trip = ActiveTrip(plan, started.state, origin)

        val controller = controller(at = NOW.plusSeconds(6 * 3600))
        runCurrent()

        assertNull(controller.active.value)
        assertNull(store.trip)
        // Hours late, its "turun" would only be noise.
        assertTrue(runtime.alerts.isEmpty())
    }

    @Test
    fun `a restore that finishes before the controller is built still picks up`() = runTest {
        val started = TripEngine.start(plan, NOW, hasLocation = true)
        store.trip = ActiveTrip(plan, started.state, origin)

        // As on a thread pool: the restore runs to its end before the constructor has moved on.
        val controller = controller(at = NOW.plusSeconds(60), scope = backgroundScope + UnconfinedTestDispatcher(testScheduler))
        runCurrent()

        assertNotNull(controller.active.value)
        assertTrue(runtime.tracking)
    }
}
