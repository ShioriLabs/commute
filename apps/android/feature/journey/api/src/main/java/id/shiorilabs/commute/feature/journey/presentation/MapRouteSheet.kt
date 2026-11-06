package id.shiorilabs.commute.feature.journey.presentation

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import id.shiorilabs.commute.core.navigation.Route
import id.shiorilabs.commute.feature.journey.domain.Journey
import id.shiorilabs.commute.feature.journey.domain.PairEnd

/**
 * What a route on the map shows: the pair asked for, its ends' names once known, and the journey
 * to draw, null until one is in.
 */
data class MapRouteShown(
    val fromId: String?,
    val toId: String?,
    val fromName: String? = null,
    val toName: String? = null,
    val journey: Journey? = null,
)

/**
 * OTW on the map: the planner and the trip page as the map's sheet shows them, the web's map fare
 * sheet with Android's trip page in it. A seam, as [OtwPanel] is: the map may not depend on the
 * journey feature's implementation. The map holds the pair; the sheet asks for it under the rider's
 * settings and says what to draw.
 */
interface MapRouteSheet {

    /**
     * The pair [fromId] to [toId]'s options, or with [journey] that journey's page.
     *
     * [onPairChange] is the pair as the rider changed it in the sheet: its fields, swap, picker or
     * recent pairs. [onOpenJourney] and [onCloseJourney] move between the two pages. [onShown] is
     * what the map should draw: the first option on the options page, the journey on its own.
     * [onPickOnMap] gives way to the map for [PairEnd] to be tapped there; [onTripStarted] follows
     * OTW!, the trip running; [onClose] closes the sheet.
     */
    @Composable
    fun Content(
        fromId: String?,
        toId: String?,
        journey: Route.Trip?,
        onPairChange: (fromId: String?, toId: String?) -> Unit,
        onOpenJourney: (Route.Trip) -> Unit,
        onCloseJourney: () -> Unit,
        onShown: (MapRouteShown) -> Unit,
        onPickOnMap: (PairEnd) -> Unit,
        onTripStarted: () -> Unit,
        onClose: () -> Unit,
        modifier: Modifier,
    )

    /** The route folded away, the web's fare chip: "From → To" and [shown]'s fare. */
    @Composable
    fun Chip(shown: MapRouteShown, onOpen: () -> Unit, onClear: () -> Unit, modifier: Modifier)
}
