package id.shiorilabs.commute.feature.search.navigation

import androidx.navigation3.runtime.EntryProviderScope
import androidx.navigation3.runtime.NavKey
import id.shiorilabs.commute.core.navigation.NavGraphContribution
import id.shiorilabs.commute.core.navigation.NavGraphScope
import id.shiorilabs.commute.core.navigation.Route
import id.shiorilabs.commute.core.ui.morph.navCardMorphMetadata
import id.shiorilabs.commute.core.ui.motion.pageTransitionMetadata
import id.shiorilabs.commute.core.ui.motion.sharedElementSourceMetadata
import id.shiorilabs.commute.feature.journey.presentation.OtwPanel
import id.shiorilabs.commute.feature.search.presentation.SearchScreen
import javax.inject.Inject

/**
 * Contributes [Route.Search], opened by the home screen's "Mau ke mana?" card morph, and [Route.Otw],
 * the same screen on its OTW tab with a pair already in, opened as a page. The OTW tab is the
 * journey feature's [OtwPanel], handed in here so search never depends on journey's internals.
 */
class SearchNavContribution @Inject constructor(
    private val otwPanel: OtwPanel,
) : NavGraphContribution {

    override fun EntryProviderScope<NavKey>.addEntries(scope: NavGraphScope) {
        // A station row's name and roundels fly into the station page.
        entry<Route.Search>(metadata = navCardMorphMetadata() + sharedElementSourceMetadata()) {
            SearchScreen(innerPadding = scope.screenPadding, otwPanel = otwPanel)
        }
        entry<Route.Otw>(metadata = pageTransitionMetadata() + sharedElementSourceMetadata()) { key ->
            SearchScreen(innerPadding = scope.screenPadding, otwPanel = otwPanel, otwSeed = key)
        }
    }
}
