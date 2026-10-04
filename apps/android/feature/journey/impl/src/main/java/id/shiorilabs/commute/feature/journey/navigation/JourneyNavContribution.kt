package id.shiorilabs.commute.feature.journey.navigation

import androidx.navigation3.runtime.EntryProviderScope
import androidx.navigation3.runtime.NavKey
import id.shiorilabs.commute.core.navigation.NavGraphContribution
import id.shiorilabs.commute.core.navigation.NavGraphScope
import id.shiorilabs.commute.core.navigation.Route
import id.shiorilabs.commute.core.ui.motion.pageTransitionMetadata
import id.shiorilabs.commute.feature.journey.presentation.trip.TripScreen
import javax.inject.Inject

/** Contributes [Route.Trip], one journey in full: it slides in over the OTW tab or home it came from. */
class JourneyNavContribution @Inject constructor() : NavGraphContribution {

    override fun EntryProviderScope<NavKey>.addEntries(scope: NavGraphScope) {
        entry<Route.Trip>(metadata = pageTransitionMetadata()) { key ->
            TripScreen(route = key, innerPadding = scope.screenPadding)
        }
    }
}
