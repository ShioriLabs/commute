package id.shiorilabs.commute.feature.card.api

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.Dp

/**
 * Listens for a card touched to the phone while home is on screen, and shows what it read: a pill
 * above the nav rail, opening the card's detail. Draws nothing without NFC, or before a card.
 *
 * A seam, as `SavedRouteCard` is: home may not depend on how a card is read or worded. [railHeight]
 * is how far the pill must sit above the bottom edge to clear home's nav rail.
 */
interface CardTap {

    @Composable
    fun Content(railHeight: Dp, modifier: Modifier)
}
