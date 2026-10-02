package id.shiorilabs.commute.feature.station.navigation

import androidx.navigation3.runtime.EntryProviderScope
import androidx.navigation3.runtime.NavKey
import id.shiorilabs.commute.core.navigation.NavGraphContribution
import id.shiorilabs.commute.core.navigation.NavGraphScope
import id.shiorilabs.commute.core.navigation.Route
import id.shiorilabs.commute.feature.station.presentation.StationScreen
import javax.inject.Inject

/** Contributes [Route.Station], a station's page, opened from search and the home feed. */
class StationNavContribution @Inject constructor() : NavGraphContribution {

    override fun EntryProviderScope<NavKey>.addEntries(scope: NavGraphScope) {
        entry<Route.Station> { key ->
            StationScreen(stationId = key.stationId, innerPadding = scope.screenPadding)
        }
    }
}
