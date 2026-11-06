package id.shiorilabs.commute.feature.map.navigation

import androidx.navigation3.runtime.EntryProviderScope
import androidx.navigation3.runtime.NavKey
import id.shiorilabs.commute.core.navigation.NavGraphContribution
import id.shiorilabs.commute.core.navigation.NavGraphScope
import id.shiorilabs.commute.core.navigation.Route
import id.shiorilabs.commute.core.ui.morph.navCardMorphMetadata
import id.shiorilabs.commute.feature.hub.presentation.HubSheet
import id.shiorilabs.commute.feature.journey.presentation.MapRouteSheet
import id.shiorilabs.commute.feature.line.presentation.LineSheet
import id.shiorilabs.commute.feature.map.presentation.MapScreen
import id.shiorilabs.commute.feature.station.presentation.StationSheet
import javax.inject.Inject

/**
 * Contributes [Route.Map], the FDTJ integration map: it grows out of home's rail card, as the
 * other rail screens do, and opens from a `/map` link. The station, hub, line and journey features'
 * sheets are handed in here, so the map never depends on their internals.
 */
class MapNavContribution @Inject constructor(
    private val stationSheet: StationSheet,
    private val hubSheet: HubSheet,
    private val lineSheet: LineSheet,
    private val routeSheet: MapRouteSheet,
) : NavGraphContribution {

    override fun EntryProviderScope<NavKey>.addEntries(scope: NavGraphScope) {
        entry<Route.Map>(metadata = navCardMorphMetadata()) { key ->
            MapScreen(
                route = key,
                innerPadding = scope.screenPadding,
                stationSheet = stationSheet,
                hubSheet = hubSheet,
                lineSheet = lineSheet,
                routeSheet = routeSheet,
            )
        }
    }
}
