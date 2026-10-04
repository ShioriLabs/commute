package id.shiorilabs.commute.core.navigation

import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.remember
import androidx.navigation3.runtime.NavBackStack
import androidx.navigation3.runtime.NavKey
import androidx.navigation3.runtime.rememberNavBackStack

/**
 * The app's navigation state: one back stack rooted at [Route.Home].
 *
 * - [goTo] — push a destination.
 * - [pop] — back one level; returns `false` at the root so the caller can let the system handle it.
 * - [replace] — swap what's on screen for another destination, leaving nothing to come back to.
 */
@Stable
class CommuteNavigator(
    val backStack: NavBackStack<NavKey>,
) {

    /** Top of the stack — what's on screen. */
    val currentKey: NavKey?
        get() = backStack.lastOrNull()

    /** Pushes [key]; a no-op when it is already on screen, so a double tap can't stack it twice. */
    fun goTo(key: Route) {
        if (currentKey == key) {
            return
        }
        backStack.add(key)
    }

    /** Puts [key] where the top of the stack was. At the root, pushes it instead: home stays. */
    fun replace(key: Route) {
        if (backStack.size <= 1) {
            backStack.add(key)
            return
        }
        backStack[backStack.lastIndex] = key
    }

    fun pop(): Boolean {
        if (backStack.size <= 1) {
            return false
        }
        backStack.removeAt(backStack.lastIndex)
        return true
    }
}

/**
 * Creates a [CommuteNavigator] whose back stack survives configuration changes and process death
 * ([rememberNavBackStack] persists the serializable keys).
 */
@Composable
fun rememberCommuteNavigator(): CommuteNavigator {
    val backStack = rememberNavBackStack(Route.Home)
    return remember(backStack) { CommuteNavigator(backStack) }
}

/**
 * Exposes the app [CommuteNavigator] to any composable. Provided once in `CommuteApp.kt`; read with
 * `LocalNavigator.current`.
 */
val LocalNavigator = compositionLocalOf<CommuteNavigator> {
    error("No CommuteNavigator provided")
}
