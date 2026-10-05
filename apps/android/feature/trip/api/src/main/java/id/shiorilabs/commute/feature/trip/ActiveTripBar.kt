package id.shiorilabs.commute.feature.trip

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.Dp
import kotlinx.coroutines.flow.StateFlow

/**
 * The running trip's bar, pinned over every screen while a trip runs: what's next, the minutes to
 * getting off, and a way back into the trip. Bound by the trip feature, so the app shell needn't
 * know how a trip is told.
 */
interface ActiveTripBar {

    /** Whether there is a trip to show, so the shell can give the bar its room. */
    val visible: StateFlow<Boolean>

    /** Draws nothing when there is no trip. [topInset] is the status bar's height, drawn behind. */
    @Composable
    fun Content(topInset: Dp, modifier: Modifier)
}
