package id.shiorilabs.commute.feature.saved.navigation

import androidx.navigation3.runtime.EntryProviderScope
import androidx.navigation3.runtime.NavKey
import id.shiorilabs.commute.core.navigation.NavGraphContribution
import id.shiorilabs.commute.core.navigation.NavGraphScope
import id.shiorilabs.commute.core.navigation.Route
import id.shiorilabs.commute.core.ui.motion.sharedElementSourceMetadata
import id.shiorilabs.commute.feature.journey.presentation.SavedRouteCard
import id.shiorilabs.commute.feature.saved.presentation.SavedStationsScreen
import id.shiorilabs.commute.feature.trip.ActiveTripCard
import javax.inject.Inject

/**
 * Contributes [Route.Home], the pinned stations and pairs, to the app back stack. A pair's card is
 * the journey feature's [SavedRouteCard], and a running trip the trip feature's [ActiveTripCard],
 * handed in here so home never depends on their internals.
 */
class SavedNavContribution @Inject constructor(
    private val savedRouteCard: SavedRouteCard,
    private val activeTripCard: ActiveTripCard,
) : NavGraphContribution {

    override fun EntryProviderScope<NavKey>.addEntries(scope: NavGraphScope) {
        // Its station names and line cards fly into the station page.
        entry<Route.Home>(metadata = sharedElementSourceMetadata()) {
            SavedStationsScreen(
                innerPadding = scope.screenPadding,
                savedRouteCard = savedRouteCard,
                activeTripCard = activeTripCard,
            )
        }
    }
}
