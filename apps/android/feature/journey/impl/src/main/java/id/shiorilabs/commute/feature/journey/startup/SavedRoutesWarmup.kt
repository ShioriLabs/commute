package id.shiorilabs.commute.feature.journey.startup

import id.shiorilabs.commute.core.datastore.FarePreferencesRepository
import id.shiorilabs.commute.core.datastore.SavedEntry
import id.shiorilabs.commute.core.datastore.SavedRepository
import id.shiorilabs.commute.core.startup.StartupWarmup
import id.shiorilabs.commute.feature.journey.data.JourneyRepository
import id.shiorilabs.commute.feature.journey.presentation.savedroute.homeRouteCriteria
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import java.time.Clock
import javax.inject.Inject

/**
 * Reads each pinned pair's answer into memory while the splash plays, under the settings its card
 * on home asks with, so the card paints its rows on home's first frame. Reading the settings is
 * also what lets the card find them without a read of its own.
 */
class SavedRoutesWarmup @Inject constructor(
    private val savedRepository: SavedRepository,
    private val farePreferences: FarePreferencesRepository,
    private val journeyRepository: JourneyRepository,
    private val clock: Clock,
) : StartupWarmup {

    override suspend fun warm() = coroutineScope {
        val routes = savedRepository.entries.first().filterIsInstance<SavedEntry.Route>()
        val criteria = farePreferences.criteria.first().homeRouteCriteria(clock.instant())
        for (route in routes) {
            // The first value is what the disk held; a stale one goes on refreshing on its own.
            launch { journeyRepository.observeTrips(route.fromId, route.toId, criteria).first() }
        }
    }
}
