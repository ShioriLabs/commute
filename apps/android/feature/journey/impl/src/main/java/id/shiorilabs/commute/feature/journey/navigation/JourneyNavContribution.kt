package id.shiorilabs.commute.feature.journey.navigation

import androidx.navigation3.runtime.EntryProviderScope
import androidx.navigation3.runtime.NavKey
import id.shiorilabs.commute.core.navigation.NavGraphContribution
import id.shiorilabs.commute.core.navigation.NavGraphScope
import id.shiorilabs.commute.core.navigation.Route
import id.shiorilabs.commute.core.ui.motion.pageTransitionMetadata
import id.shiorilabs.commute.feature.journey.presentation.JourneyScreen
import javax.inject.Inject

/** Contributes [Route.Journey], OTW as a page: it slides in over the station or search it came from. */
class JourneyNavContribution @Inject constructor() : NavGraphContribution {

    override fun EntryProviderScope<NavKey>.addEntries(scope: NavGraphScope) {
        entry<Route.Journey>(metadata = pageTransitionMetadata()) { key ->
            JourneyScreen(route = key, innerPadding = scope.screenPadding)
        }
    }
}
