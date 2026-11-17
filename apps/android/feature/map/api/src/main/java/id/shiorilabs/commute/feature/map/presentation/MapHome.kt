package id.shiorilabs.commute.feature.map.presentation

import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier

/**
 * Home on the map, the Experimental "Peta di Beranda" prototype: the map over the top of the screen,
 * and in its sheet what home hands in. The map feature's seam, so home never depends on its
 * internals, nor the map on home's.
 */
interface MapHome {

    /**
     * The map with home's [feed] in its sheet, resting part way up. Panning the map turns the sheet
     * to the stations in view, drawn by [nearby]; a station tapped, on the map or through either's
     * `openStation`, opens the map's own station sheet. [rail] floats over the foot of the screen
     * while home's feed is what the sheet shows.
     *
     * The map opens around [riderNear], the stations nearest the rider: null while home is still
     * looking, empty when it found none in reach (or can't look), and then it opens on Manggarai.
     */
    @Composable
    fun Content(
        innerPadding: PaddingValues,
        feed: @Composable (openStation: (stationId: String) -> Unit) -> Unit,
        nearby: @Composable (stationIds: List<String>, openStation: (stationId: String) -> Unit) -> Unit,
        rail: @Composable BoxScope.() -> Unit,
        riderNear: List<NearStation>?,
        modifier: Modifier,
    )
}
