package id.shiorilabs.commute.feature.saved.navigation

import androidx.navigation3.runtime.EntryProviderScope
import androidx.navigation3.runtime.NavKey
import id.shiorilabs.commute.core.navigation.NavGraphContribution
import id.shiorilabs.commute.core.navigation.NavGraphScope
import id.shiorilabs.commute.core.navigation.Route
import id.shiorilabs.commute.core.ui.motion.sharedElementSourceMetadata
import id.shiorilabs.commute.feature.saved.presentation.SavedStationsScreen
import javax.inject.Inject

/** Contributes [Route.Home], the saved stations list, to the app back stack. */
class SavedNavContribution @Inject constructor() : NavGraphContribution {

    override fun EntryProviderScope<NavKey>.addEntries(scope: NavGraphScope) {
        // Its station names and line cards fly into the station page.
        entry<Route.Home>(metadata = sharedElementSourceMetadata()) {
            SavedStationsScreen(innerPadding = scope.screenPadding)
        }
    }
}
