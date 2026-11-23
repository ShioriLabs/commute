package id.shiorilabs.commute.feature.map.presentation

import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import id.shiorilabs.commute.feature.map.domain.BusMapLineInfo
import id.shiorilabs.commute.feature.map.domain.GeoStop

/**
 * Release builds leave the streets layer out, Peta Bus and MapLibre with it, while both are still
 * being worked on: [MapViewModel.streetsEnabled] stays false, so nothing here is ever reached. The
 * real layer is under src/debug.
 */
internal const val STREETS_AVAILABLE = false

@Composable
@Suppress("UNUSED_PARAMETER")
fun StreetsMap(
    state: StreetsMapState,
    styleUrl: String,
    busMap: BusMapLayer?,
    dark: Boolean,
    onStationTap: (stationId: String) -> Unit,
    modifier: Modifier = Modifier,
    onTap: () -> Unit = {},
    onUserMove: () -> Unit = {},
    onLineTap: (codes: List<String>) -> Unit = {},
    isolated: String? = null,
    lines: StreetsLines = StreetsLines.ADJUSTED,
    feed: String? = null,
    dots: StreetsDots = StreetsDots.ALL,
    overview: StreetsOverview = StreetsOverview.BUNDLED,
    apart: StreetsApart = StreetsApart.SEPARATED,
    city: StreetsCity = StreetsCity.JAKARTA,
    weight: StreetsWeight = StreetsWeight.NORMAL,
    joins: StreetsJoins = StreetsJoins.CONTINUOUS,
) = Unit

@Stable
@Suppress("UNUSED_PARAMETER")
class StreetsMapState {

    val bearing: Double = 0.0

    fun setBottomInset(px: Double) = Unit

    fun stationsInView(stops: List<GeoStop>, limit: Int): List<String> = emptyList()

    fun frame(line: BusMapLineInfo, bottomPx: Double, edgePx: Double) = Unit

    fun northUp() = Unit

    fun recenter() = Unit
}

@Composable
@Suppress("UNUSED_PARAMETER")
fun rememberStreetsMapState(session: MapSession): StreetsMapState = remember { StreetsMapState() }
