package id.shiorilabs.commute.feature.search.navigation

import androidx.navigation3.runtime.EntryProviderScope
import androidx.navigation3.runtime.NavKey
import id.shiorilabs.commute.core.navigation.NavGraphContribution
import id.shiorilabs.commute.core.navigation.NavGraphScope
import id.shiorilabs.commute.core.navigation.Route
import id.shiorilabs.commute.core.ui.morph.navCardMorphMetadata
import id.shiorilabs.commute.core.ui.motion.sharedElementSourceMetadata
import id.shiorilabs.commute.feature.search.presentation.SearchScreen
import javax.inject.Inject

/** Contributes [Route.Search], opened by the home screen's "Mau ke mana?" card morph. */
class SearchNavContribution @Inject constructor() : NavGraphContribution {

    override fun EntryProviderScope<NavKey>.addEntries(scope: NavGraphScope) {
        // A station row's name and roundels fly into the station page.
        entry<Route.Search>(metadata = navCardMorphMetadata() + sharedElementSourceMetadata()) {
            SearchScreen(innerPadding = scope.screenPadding)
        }
    }
}
