package id.shiorilabs.commute.feature.trip.wear

import id.shiorilabs.commute.core.navigation.Route
import id.shiorilabs.commute.core.trip.RiderAction
import id.shiorilabs.commute.core.trip.TripPlan
import id.shiorilabs.commute.core.wearable.WearPaths
import id.shiorilabs.commute.feature.trip.ActiveTrip
import id.shiorilabs.commute.feature.trip.TripController
import id.shiorilabs.commute.feature.trip.TripReminder
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import org.junit.Assert.assertEquals
import org.junit.Test

class WearActionTest {

    private class RecordingController : TripController {
        val said = mutableListOf<RiderAction>()
        var stopped = 0
        override val active: StateFlow<ActiveTrip?> = MutableStateFlow(null)
        override fun start(plan: TripPlan, origin: Route.Trip) = Unit
        override fun setReminder(reminder: TripReminder) = Unit
        override fun riderSaid(action: RiderAction) {
            said += action
        }
        override fun stop() {
            stopped++
        }
    }

    @Test
    fun `a tap on the watch is the rider saying it`() {
        val controller = RecordingController()
        listOf(RiderAction.BOARDED, RiderAction.ALIGHTED, RiderAction.STILL_ON_ROUTE)
            .forEach { controller.onWearAction(WearPaths.encodeAction(it)) }
        assertEquals(listOf(RiderAction.BOARDED, RiderAction.ALIGHTED, RiderAction.STILL_ON_ROUTE), controller.said)
        assertEquals(0, controller.stopped)
    }

    @Test
    fun `stop on the watch stops the trip`() {
        val controller = RecordingController()
        controller.onWearAction(WearPaths.encodeAction(RiderAction.STOP))
        assertEquals(1, controller.stopped)
        assertEquals(emptyList<RiderAction>(), controller.said)
    }

    @Test
    fun `a tap this version doesn't know does nothing`() {
        val controller = RecordingController()
        controller.onWearAction("DANCE".encodeToByteArray())
        assertEquals(emptyList<RiderAction>(), controller.said)
        assertEquals(0, controller.stopped)
    }
}
