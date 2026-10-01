package id.shiorilabs.commute

import androidx.compose.animation.SharedTransitionLayout
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.viewmodel.navigation3.rememberViewModelStoreNavEntryDecorator
import androidx.navigation3.runtime.NavEntryDecorator
import androidx.navigation3.runtime.NavKey
import androidx.navigation3.runtime.entryProvider
import androidx.navigation3.runtime.rememberSaveableStateHolderNavEntryDecorator
import androidx.navigation3.ui.LocalNavAnimatedContentScope
import androidx.navigation3.ui.NavDisplay
import dagger.hilt.android.EntryPointAccessors
import id.shiorilabs.commute.core.navigation.CommuteNavigator
import id.shiorilabs.commute.core.navigation.NavGraphScope
import id.shiorilabs.commute.core.ui.morph.LocalNavAnimatedVisibilityScope
import id.shiorilabs.commute.core.ui.morph.LocalSharedTransitionScope
import id.shiorilabs.commute.di.NavGraphEntryPoint

/** The Navigation 3 display: renders [navigator]'s back stack from the entries features contribute. */
@Composable
fun CommuteNavDisplay(
    navigator: CommuteNavigator,
    screenPadding: () -> PaddingValues,
    modifier: Modifier = Modifier,
) {
    // Feature :impl modules bind their Nav3 entries @IntoSet; collect them via a Hilt EntryPoint
    // (CommuteNavDisplay is a plain @Composable, so it can't receive a constructor injection).
    val context = LocalContext.current

    val contributions = remember(context) {
        EntryPointAccessors.fromApplication(
            context.applicationContext,
            NavGraphEntryPoint::class.java,
        ).navContributions()
    }

    // NavDisplay caches each NavEntry (and the content lambda that reads screenPadding) by
    // content-key, so this scope must be a single stable instance that reads the *current* padding
    // rather than a fresh instance per padding change — the cached entries would otherwise keep the
    // stale value captured when they were first built. rememberUpdatedState keeps the live value
    // reachable from the never-rekeyed scope.
    val currentScreenPadding by rememberUpdatedState(screenPadding)

    val navGraphScope = remember {
        NavGraphScope(screenPaddingProvider = { currentScreenPadding() })
    }

    // Replay each feature :impl's contributed entries into this single entryProvider.
    val provider = remember(contributions, navGraphScope) {
        entryProvider {
            val builder = this

            contributions.forEach { contribution ->
                with(contribution) {
                    builder.addEntries(navGraphScope)
                }
            }
        }
    }

    // Lets a nav entry's content reach its own enter/exit scope without depending on Navigation 3's
    // UI module, which is what the card morph keys its animations off. Remembered: a fresh
    // decorator per recomposition would re-key every entry.
    val animatedScopeDecorator = remember {
        NavEntryDecorator<NavKey> { entry ->
            CompositionLocalProvider(
                LocalNavAnimatedVisibilityScope provides LocalNavAnimatedContentScope.current,
            ) {
                entry.Content()
            }
        }
    }

    SharedTransitionLayout(modifier = modifier) {
        CompositionLocalProvider(LocalSharedTransitionScope provides this) {
            NavDisplay(
                backStack = navigator.backStack,
                onBack = { navigator.pop() },
                // Per-entry saved state + ViewModel scope, so a screen's ViewModel lives exactly as
                // long as its back-stack entry.
                entryDecorators = listOf(
                    rememberSaveableStateHolderNavEntryDecorator(),
                    rememberViewModelStoreNavEntryDecorator(),
                    animatedScopeDecorator,
                ),
                sharedTransitionScope = this,
                entryProvider = provider,
            )
        }
    }
}
