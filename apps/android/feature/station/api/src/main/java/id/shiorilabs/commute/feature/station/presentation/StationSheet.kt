package id.shiorilabs.commute.feature.station.presentation

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier

/**
 * A station's page as the map's sheet shows it, the web's StationSheet: its departures, facilities
 * and transfers. A seam, as the journey feature's OtwPanel is: the map may not depend on the
 * station feature's implementation.
 */
interface StationSheet {

    /**
     * Station [stationId]'s content. [onClose] closes the sheet; [onOpenPage] opens the full page;
     * [onOpenStation] is a transfer tapped; [onOtw] is "OTW Ke Sini".
     */
    @Composable
    fun Content(
        stationId: String,
        onClose: () -> Unit,
        onOpenPage: () -> Unit,
        onOpenStation: (stationId: String) -> Unit,
        onOtw: () -> Unit,
        modifier: Modifier,
    )
}
