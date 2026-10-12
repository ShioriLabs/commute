package id.shiorilabs.commute.feature.station.presentation

import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.TextStyle

/**
 * A station's name as it flies between the home feed and the station page's header: both ends draw
 * this same text, so it flies as one piece. The name stands alone, with no "Stasiun" or "Halte"
 * before it, so a long one wraps from the left edge like any other title.
 *
 * The flight lays the text out at the bounds it is passing through, so a name that wraps on one end
 * and not the other breaks where the bounds first allow it. Laying it out unbounded for the flight
 * instead showed it unwrapped from the first frame, then snapped back on landing.
 *
 * @param shared whether the name is a shared element with the other end of the flight.
 * @param scaleWithFlight whether the name scales to the other end in flight, for an end whose
 *   text is a different size (a search row's), rather than flying at its own size.
 */
@Composable
fun StationTitleText(
    stationId: String,
    name: String,
    style: TextStyle,
    modifier: Modifier = Modifier,
    shared: Boolean = true,
    scaleWithFlight: Boolean = false,
) {
    Text(
        text = name,
        modifier = modifier.sharedStationName(stationId, enabled = shared, scaleText = scaleWithFlight),
        style = style,
    )
}
