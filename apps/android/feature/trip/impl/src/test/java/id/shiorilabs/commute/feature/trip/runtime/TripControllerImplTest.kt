package id.shiorilabs.commute.feature.trip.runtime

import id.shiorilabs.commute.core.datastore.FakePreferencesDataStore
import id.shiorilabs.commute.core.datastore.LocationPreferencesRepository
import id.shiorilabs.commute.core.geo.GeoPoint
import id.shiorilabs.commute.core.location.Fix
import id.shiorilabs.commute.core.location.testing.FakeLocationClient
import id.shiorilabs.commute.core.trip.AlertKind
import id.shiorilabs.commute.core.trip.PositionSource
import id.shiorilabs.commute.core.trip.RiderAction
import id.shiorilabs.commute.core.trip.TripEffect
import id.shiorilabs.commute.core.trip.TripEngine
import id.shiorilabs.commute.core.trip.TripPhase
import id.shiorilabs.commute.feature.trip.ActiveTrip
import id.shiorilabs.commute.feature.trip.DUKUH_ATAS
import id.shiorilabs.commute.feature.trip.NOW
import id.shiorilabs.commute.feature.trip.origin
import id.shiorilabs.commute.feature.trip.plan
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset

class TripControllerImplTest {

    private class FakeStore(var trip: ActiveTrip? = null) : TripStore {
        override fun read() = trip
        override fun write(trip: ActiveTrip) {
            this.trip = trip
        }
        override fun clear() {
            trip = null
        }
    }

    private class FakeRuntime(var trackingAllowed: Boolean = true) : TripRuntime {
        val alerts = mutableListOf<TripEffect.Alert>()
        var progressShown = 0
        var finished = 0
        var tracking = false
        var asked = 0
        var wakeAt: Instant? = null

        override fun showProgress(trip: ActiveTrip) {
            progressShown++
        }
        override fun alert(trip: ActiveTrip, alert: TripEffect.Alert) {
            alerts += alert
        }
        override fun askStillOnRoute(trip: ActiveTrip) {
            asked++
        }
        override fun finish() {
            finished++
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

    private fun TestScope.controller(at: Instant = NOW) = TripControllerImpl(
        store = store,
        runtime = runtime,
        locator = { it },
        location = location,
        locationPreferences = locationPreferences,
        clock = Clock.fixed(at, ZoneOffset.UTC),
        scope = backgroundScope,
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
}
