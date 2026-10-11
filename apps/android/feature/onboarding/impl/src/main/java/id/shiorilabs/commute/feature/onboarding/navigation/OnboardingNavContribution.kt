package id.shiorilabs.commute.feature.onboarding.navigation

import androidx.navigation3.runtime.EntryProviderScope
import androidx.navigation3.runtime.NavKey
import id.shiorilabs.commute.core.navigation.NavGraphContribution
import id.shiorilabs.commute.core.navigation.NavGraphScope
import id.shiorilabs.commute.core.navigation.Route
import id.shiorilabs.commute.feature.onboarding.presentation.OnboardingScreen
import javax.inject.Inject

/** Contributes [Route.Onboarding], the welcome page the app opens on until the rider goes past it. */
class OnboardingNavContribution @Inject constructor() : NavGraphContribution {

    override fun EntryProviderScope<NavKey>.addEntries(scope: NavGraphScope) {
        entry<Route.Onboarding> {
            OnboardingScreen(innerPadding = scope.screenPadding)
        }
    }
}
