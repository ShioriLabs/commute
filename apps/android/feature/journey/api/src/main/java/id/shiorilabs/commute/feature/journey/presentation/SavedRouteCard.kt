package id.shiorilabs.commute.feature.journey.presentation

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier

/**
 * A saved Dari→Ke pair's card on the home screen: its next few boardings, each opening that train
 * on the OTW page, or when it runs again once tonight's service is over.
 *
 * A seam, as [OtwPanel] is: home may not depend on journey's implementation, which owns the trip
 * answer, how it is asked for and how a journey is worded. The card asks for and refreshes its own
 * answer; home lays out the pair's title above it.
 */
interface SavedRouteCard {

    @Composable
    fun Content(fromId: String, toId: String, modifier: Modifier)
}
