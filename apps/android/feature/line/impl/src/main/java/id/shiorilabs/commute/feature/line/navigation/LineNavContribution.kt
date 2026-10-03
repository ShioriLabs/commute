package id.shiorilabs.commute.feature.line.navigation

import androidx.navigation3.runtime.EntryProviderScope
import androidx.navigation3.runtime.NavKey
import id.shiorilabs.commute.core.navigation.NavGraphContribution
import id.shiorilabs.commute.core.navigation.NavGraphScope
import id.shiorilabs.commute.core.navigation.Route
import id.shiorilabs.commute.core.ui.motion.pageTransitionMetadata
import id.shiorilabs.commute.feature.line.presentation.LineScreen
import javax.inject.Inject

/**
 * Contributes [Route.Line], a line's page, opened from search, a station's line cards and
 * transfers, another line's page and a `/lines/…` link.
 */
class LineNavContribution @Inject constructor() : NavGraphContribution {

    override fun EntryProviderScope<NavKey>.addEntries(scope: NavGraphScope) {
        entry<Route.Line>(metadata = pageTransitionMetadata()) { key ->
            LineScreen(
                operator = key.operator,
                lineCode = key.lineCode,
                innerPadding = scope.screenPadding,
                placeholderTitle = key.title,
                placeholderColor = key.colorCode,
            )
        }
    }
}
