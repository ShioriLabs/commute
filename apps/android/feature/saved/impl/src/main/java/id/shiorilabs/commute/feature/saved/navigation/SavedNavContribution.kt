package id.shiorilabs.commute.feature.saved.navigation

import androidx.navigation3.runtime.EntryProviderScope
import androidx.navigation3.runtime.NavKey
import id.shiorilabs.commute.core.navigation.NavGraphContribution
import id.shiorilabs.commute.core.navigation.NavGraphScope
import id.shiorilabs.commute.core.navigation.Route
import id.shiorilabs.commute.core.ui.motion.sharedElementSourceMetadata
import id.shiorilabs.commute.feature.card.api.CardTap
import id.shiorilabs.commute.feature.journey.presentation.SavedRouteCard
import id.shiorilabs.commute.feature.saved.presentation.SavedStationsScreen
import androidx.compose.runtime.collectAsState
import id.shiorilabs.commute.core.datastore.DeveloperPreferencesRepository
import id.shiorilabs.commute.core.ui.startup.HoldStartupWhile
import id.shiorilabs.commute.feature.map.presentation.MapHome
import javax.inject.Inject

/**
 * Contributes [Route.Home], the pinned stations and pairs, to the app back stack. A pair's card is
 * the journey feature's [SavedRouteCard], handed in here so home never depends on its internals.
 */
class SavedNavContribution @Inject constructor(
    private val savedRouteCard: SavedRouteCard,
    private val cardTap: CardTap,
    private val mapHome: MapHome,
    private val developerPreferences: DeveloperPreferencesRepository,
) : NavGraphContribution {

    override fun EntryProviderScope<NavKey>.addEntries(scope: NavGraphScope) {
        // Its station names and line cards fly into the station page.
        entry<Route.Home>(metadata = sharedElementSourceMetadata()) {
            // Experimental "Peta di Beranda": read under the splash, so neither home flashes first.
            val onMap = developerPreferences.mapHome.collectAsState(initial = null).value
            HoldStartupWhile(onMap == null)
            if (onMap != null) {
                SavedStationsScreen(
                    innerPadding = scope.screenPadding,
                    savedRouteCard = savedRouteCard,
                    cardTap = cardTap,
                    mapHome = mapHome.takeIf { onMap },
                )
            }
        }
    }
}
