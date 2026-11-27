package id.shiorilabs.commute.feature.station.presentation

import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier

/**
 * A station's page under a header of the caller's own, the web's StationContent inside a hub's
 * page: its departures, facilities and transfers, with [header] standing where the station's name
 * and lines would. A seam, as [StationSheet] is: the hub feature may not depend on the station
 * feature's implementation.
 */
interface StationBody {

    /**
     * Station [stationId]'s content under [header]. [onOpenStation] is a transfer tapped; [onOtw] is
     * "OTW Ke Sini". [onIsolateLine] is a line card's name tapped, by its `OPERATOR:CODE`: false
     * when it can't be handled in place, for the line's page to open instead.
     */
    @Composable
    fun Content(
        stationId: String,
        header: @Composable () -> Unit,
        innerPadding: PaddingValues,
        onOpenStation: (stationId: String) -> Unit,
        onOtw: () -> Unit,
        onIsolateLine: (lineKey: String) -> Boolean,
        modifier: Modifier,
    )
}
