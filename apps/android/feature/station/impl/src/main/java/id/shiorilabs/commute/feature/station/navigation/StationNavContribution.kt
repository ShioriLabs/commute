package id.shiorilabs.commute.feature.station.navigation

import androidx.navigation3.runtime.EntryProviderScope
import androidx.navigation3.runtime.NavKey
import id.shiorilabs.commute.core.navigation.NavGraphContribution
import id.shiorilabs.commute.core.navigation.NavGraphScope
import id.shiorilabs.commute.core.navigation.Route
import id.shiorilabs.commute.core.ui.motion.pageTransitionMetadata
import id.shiorilabs.commute.feature.station.presentation.StationScreen
import id.shiorilabs.commute.feature.station.presentation.timetable.StationTimetableScreen
import javax.inject.Inject

/**
 * Contributes [Route.Station], a station's page, opened from search and the home feed, and
 * [Route.StationTimetable], its full timetable, which slides in over it.
 */
class StationNavContribution @Inject constructor() : NavGraphContribution {

    override fun EntryProviderScope<NavKey>.addEntries(scope: NavGraphScope) {
        // Its name, roundels and line cards fly in from home and search.
        entry<Route.Station>(metadata = pageTransitionMetadata(receivesSharedElements = true)) { key ->
            StationScreen(
                stationId = key.stationId,
                innerPadding = scope.screenPadding,
                placeholderTitle = key.title,
                placeholderLineKeys = key.lineKeys,
            )
        }
        entry<Route.StationTimetable>(metadata = pageTransitionMetadata()) { key ->
            StationTimetableScreen(
                stationId = key.stationId,
                innerPadding = scope.screenPadding,
                placeholderTitle = key.title,
            )
        }
    }
}
