package id.shiorilabs.commute.feature.card.api

import androidx.compose.runtime.Composable

/** What home's nav rail shows for the card button: two lines of text, and what a press does. */
class CardRail(
    val title: String,
    val subtitle: String,
    val description: String,
    val onClick: () -> Unit,
    /** A KMT easter egg is in play: the button wears the Taiwan flag's blue and sun. */
    val taiwan: Boolean = false,
)

/**
 * Listens for a card touched to the phone while home is on screen, and opens the card's detail from
 * the nav rail's card button. Draws nothing, button included, without NFC.
 *
 * A seam, as `SavedRouteCard` is: home may not depend on how a card is read or worded. The rail draws
 * the button in the look of its own cards, from the [CardRail] [Content] hands to [rail].
 */
interface CardTap {

    @Composable
    fun Content(rail: @Composable (CardRail) -> Unit)
}
