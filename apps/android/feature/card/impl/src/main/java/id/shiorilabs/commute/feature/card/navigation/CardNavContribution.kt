package id.shiorilabs.commute.feature.card.navigation

import androidx.navigation3.runtime.EntryProviderScope
import androidx.navigation3.runtime.NavKey
import id.shiorilabs.commute.core.navigation.NavGraphContribution
import id.shiorilabs.commute.core.navigation.NavGraphScope
import id.shiorilabs.commute.core.navigation.Route
import id.shiorilabs.commute.core.ui.motion.pageTransitionMetadata
import id.shiorilabs.commute.feature.card.presentation.CardDumperScreen
import javax.inject.Inject

/** The card dumper, opened from Pengaturan → Experimental in a debug build. */
class CardNavContribution @Inject constructor() : NavGraphContribution {

    override fun EntryProviderScope<NavKey>.addEntries(scope: NavGraphScope) {
        entry<Route.CardDumper>(metadata = pageTransitionMetadata()) {
            CardDumperScreen(innerPadding = scope.screenPadding)
        }
    }
}
