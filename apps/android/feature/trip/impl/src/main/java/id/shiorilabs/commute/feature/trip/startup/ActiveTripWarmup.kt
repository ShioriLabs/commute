package id.shiorilabs.commute.feature.trip.startup

import id.shiorilabs.commute.core.datastore.OtwPreferencesRepository
import id.shiorilabs.commute.core.startup.StartupWarmup
import id.shiorilabs.commute.feature.trip.runtime.TripControllerImpl
import id.shiorilabs.commute.feature.trip.wear.WearTripSync
import kotlinx.coroutines.flow.first
import javax.inject.Inject

/**
 * Picks a running trip back up as the app starts: creating the controller reads it off the disk, so
 * a trip the system interrupted carries on, and home can show it, without waiting for a screen to
 * ask. The watch is told about it from here too, for as long as the process lives. Whether the
 * board draws its diagram is read here too, so the trip page has it from its first frame.
 */
class ActiveTripWarmup @Inject constructor(
    private val controller: TripControllerImpl,
    private val wear: WearTripSync,
    private val otwPreferences: OtwPreferencesRepository,
) : StartupWarmup {

    override suspend fun warm() {
        controller.active.value
        otwPreferences.pidsDiagram.first()
        wear.start()
    }
}
