package id.shiorilabs.commute.core.navigation

import androidx.compose.foundation.layout.PaddingValues

/**
 * The app-owned scaffolding a feature's [NavGraphContribution] needs to build its Nav3 entries
 * without depending on `:app`.
 *
 * [screenPadding] is a **live** read, not a snapshot: `NavDisplay` caches each `NavEntry` (and its
 * content lambda) by content-key, so a single [NavGraphScope] instance is held across the app's
 * lifetime while the padding itself changes (system-bar insets settle). Backing it with
 * [screenPaddingProvider] means an entry that reads `scope.screenPadding` subscribes to the current
 * value and recomposes when it changes, instead of freezing the value captured when the entry was
 * first built.
 *
 * @property screenPadding the content insets the host applies (system bars).
 */
class NavGraphScope(
    private val screenPaddingProvider: () -> PaddingValues,
) {

    val screenPadding: PaddingValues get() = screenPaddingProvider()
}
