package id.shiorilabs.commute.feature.trip

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import kotlinx.coroutines.flow.StateFlow

/**
 * Home's card for the running trip: what to do next, and a way back into it. A seam like the saved
 * pair's card, bound by the trip feature, so home needn't know how a trip is told.
 */
interface ActiveTripCard {

    /** Whether there is a trip to show, so home can give the card its row. */
    val visible: StateFlow<Boolean>

    /** Draws nothing when there is no trip. */
    @Composable
    fun Content(modifier: Modifier)
}
