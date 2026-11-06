package id.shiorilabs.commute.feature.hub.presentation

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier

/**
 * A hub's page as the map's sheet shows it, the web's HubSheet: its name and kind, then its member
 * stations. A seam, as the journey feature's OtwPanel is: the map may not depend on the hub
 * feature's implementation.
 */
interface HubSheet {

    /**
     * Hub [slug]'s content. [onClose] closes the sheet; [onOpenPage] opens the hub's full page;
     * [onOpenStation] is a member tapped, by its `OPERATOR-CODE`.
     */
    @Composable
    fun Content(
        slug: String,
        onClose: () -> Unit,
        onOpenPage: () -> Unit,
        onOpenStation: (stationId: String) -> Unit,
        modifier: Modifier,
    )
}
