package id.shiorilabs.commute.core.navigation

import androidx.navigation3.runtime.EntryProviderScope
import androidx.navigation3.runtime.NavKey

/**
 * A feature `:impl` module contributes its Nav3 back-stack entries by binding an implementation of
 * this interface `@IntoSet`. `:app`'s `CommuteNavDisplay` collects the whole set and replays each
 * contribution's [addEntries] into the single `entryProvider`, so adding a screen touches its
 * feature and [Route], never `:app`.
 */
interface NavGraphContribution {

    /**
     * Register this feature's `entry<Route.X> { … }` blocks on [this] builder, using [scope] for the
     * shared padding.
     */
    fun EntryProviderScope<NavKey>.addEntries(scope: NavGraphScope)
}
