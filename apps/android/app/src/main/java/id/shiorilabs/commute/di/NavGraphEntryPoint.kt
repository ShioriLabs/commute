package id.shiorilabs.commute.di

import dagger.hilt.EntryPoint
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import id.shiorilabs.commute.core.navigation.NavGraphContribution

/**
 * Bridges the Hilt-multibound `Set<NavGraphContribution>` (each feature `:impl` binds one `@IntoSet`)
 * into `CommuteNavDisplay`, which is a plain `@Composable` and so can't take a constructor injection.
 * Resolved once via `EntryPointAccessors.fromApplication(...)`.
 */
@EntryPoint
@InstallIn(SingletonComponent::class)
interface NavGraphEntryPoint {

    fun navContributions(): Set<@JvmSuppressWildcards NavGraphContribution>
}
