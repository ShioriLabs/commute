package id.shiorilabs.commute.feature.hub.navigation

import androidx.navigation3.runtime.EntryProviderScope
import androidx.navigation3.runtime.NavKey
import id.shiorilabs.commute.core.navigation.NavGraphContribution
import id.shiorilabs.commute.core.navigation.NavGraphScope
import id.shiorilabs.commute.core.navigation.Route
import id.shiorilabs.commute.core.ui.motion.pageTransitionMetadata
import id.shiorilabs.commute.feature.hub.presentation.HubScreen
import id.shiorilabs.commute.feature.station.presentation.StationBody
import javax.inject.Inject

/**
 * Contributes [Route.Hub], a hub's page, opened from search, a `/hubs/…` link and the map. The
 * station feature's page is handed in, to show under a place hub's header.
 */
class HubNavContribution @Inject constructor(
    private val stationBody: StationBody,
) : NavGraphContribution {

    override fun EntryProviderScope<NavKey>.addEntries(scope: NavGraphScope) {
        entry<Route.Hub>(metadata = pageTransitionMetadata()) { key ->
            HubScreen(
                slug = key.slug,
                innerPadding = scope.screenPadding,
                placeholderTitle = key.title,
                initialMemberId = key.memberId,
                stationBody = stationBody,
            )
        }
    }
}
