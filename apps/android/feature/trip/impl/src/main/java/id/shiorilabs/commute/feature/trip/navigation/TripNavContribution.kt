package id.shiorilabs.commute.feature.trip.navigation

import androidx.navigation3.runtime.EntryProviderScope
import androidx.navigation3.runtime.NavKey
import id.shiorilabs.commute.core.navigation.NavGraphContribution
import id.shiorilabs.commute.core.navigation.NavGraphScope
import id.shiorilabs.commute.core.navigation.Route
import id.shiorilabs.commute.core.ui.motion.pageTransitionMetadata
import id.shiorilabs.commute.feature.trip.presentation.ActiveTripScreen
import javax.inject.Inject

/** Contributes [Route.ActiveTrip], the trip being followed: it slides in like the trip page. */
class TripNavContribution @Inject constructor() : NavGraphContribution {

    override fun EntryProviderScope<NavKey>.addEntries(scope: NavGraphScope) {
        entry<Route.ActiveTrip>(metadata = pageTransitionMetadata()) {
            ActiveTripScreen(innerPadding = scope.screenPadding)
        }
    }
}
