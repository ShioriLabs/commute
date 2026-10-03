package id.shiorilabs.commute.core.ui.frost

import androidx.compose.animation.EnterExitState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import id.shiorilabs.commute.core.ui.morph.LocalNavAnimatedVisibilityScope

/**
 * Whether the page's enter transition has settled, fully open. The frost waits on it: Haze has
 * nothing steady to sample while the page is still sliding or its shared elements are still flying.
 *
 * True with no navigation scope at all, as in previews, so what it gates shows rather than never.
 */
@Composable
fun rememberNavTransitionSettled(): Boolean {
    val scope = LocalNavAnimatedVisibilityScope.current ?: return true
    val transition = scope.transition
    val settled by remember(transition) {
        derivedStateOf {
            transition.currentState == transition.targetState &&
                transition.currentState == EnterExitState.Visible
        }
    }
    return settled
}
