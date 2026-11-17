package id.shiorilabs.commute.feature.map.presentation

import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import id.shiorilabs.commute.feature.hub.presentation.HubSheet
import id.shiorilabs.commute.feature.journey.presentation.MapRouteSheet
import id.shiorilabs.commute.feature.line.presentation.LineSheet
import id.shiorilabs.commute.feature.station.presentation.StationSheet
import javax.inject.Inject

/** Home on the map, with the map's own sheets for what's tapped on it. */
class MapHomeImpl @Inject constructor(
    private val stationSheet: StationSheet,
    private val hubSheet: HubSheet,
    private val lineSheet: LineSheet,
    private val routeSheet: MapRouteSheet,
) : MapHome {

    @Composable
    override fun Content(
        innerPadding: PaddingValues,
        feed: @Composable (openStation: (stationId: String) -> Unit) -> Unit,
        nearby: @Composable (stationIds: List<String>, openStation: (stationId: String) -> Unit) -> Unit,
        rail: @Composable BoxScope.() -> Unit,
        riderNear: List<NearStation>?,
        modifier: Modifier,
    ) {
        MapHomeScreen(
            innerPadding = innerPadding,
            slots = HomeSlots(feed = feed, nearby = nearby, rail = rail, riderNear = riderNear),
            stationSheet = stationSheet,
            hubSheet = hubSheet,
            lineSheet = lineSheet,
            routeSheet = routeSheet,
            modifier = modifier,
        )
    }
}
