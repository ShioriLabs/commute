package id.shiorilabs.commute.feature.trip.startup

import id.shiorilabs.commute.core.startup.StartupWarmup
import id.shiorilabs.commute.feature.trip.runtime.TripControllerImpl
import javax.inject.Inject

/**
 * Picks a running trip back up as the app starts: creating the controller reads it off the disk, so
 * a trip the system interrupted carries on, and home can show it, without waiting for a screen to
 * ask.
 */
class ActiveTripWarmup @Inject constructor(
    private val controller: TripControllerImpl,
) : StartupWarmup {

    override suspend fun warm() {
        controller.active.value
    }
}
