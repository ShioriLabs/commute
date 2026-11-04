package id.shiorilabs.commute.feature.map.navigation

import androidx.navigation3.runtime.EntryProviderScope
import androidx.navigation3.runtime.NavKey
import id.shiorilabs.commute.core.navigation.NavGraphContribution
import id.shiorilabs.commute.core.navigation.NavGraphScope
import id.shiorilabs.commute.core.navigation.Route
import id.shiorilabs.commute.core.ui.motion.pageTransitionMetadata
import id.shiorilabs.commute.feature.map.presentation.MapScreen
import javax.inject.Inject

/** Contributes [Route.Map], the FDTJ integration map, opened from home's rail and a `/map` link. */
class MapNavContribution @Inject constructor() : NavGraphContribution {

    override fun EntryProviderScope<NavKey>.addEntries(scope: NavGraphScope) {
        entry<Route.Map>(metadata = pageTransitionMetadata()) {
            MapScreen(innerPadding = scope.screenPadding)
        }
    }
}
