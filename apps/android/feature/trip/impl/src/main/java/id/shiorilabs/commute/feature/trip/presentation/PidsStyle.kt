package id.shiorilabs.commute.feature.trip.presentation

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.Dp
import id.shiorilabs.commute.feature.station.domain.LineInfo

/**
 * Which look the trip's live display takes: the board on the trip page and the bar over every
 * screen. Each style carries the options only it has; all of them draw the same [Pids].
 */
internal sealed interface PidsStyle {

    /** The first: JR East's in-train display, as on the Bekasi line's ex-JR sets. */
    data class BekasiRailway(
        /** "Diagram ala Layar Kereta Jepang" in Pengaturan → OTW: off, the plate stands alone, without the curved strip of stops ahead. */
        val diagram: Boolean = true,
        /** "Halaman PIDS" in Experimental: the strip takes turns with other pages. */
        val pages: Boolean = false,
    ) : PidsStyle
}

/** The trip page's board, in [style]. */
@Composable
internal fun PidsBoard(
    style: PidsStyle,
    pids: Pids,
    lines: Map<String, LineInfo>,
    /** The lines at [Pids.stationId], keyed `OPERATOR:CODE`, for "bisa pindah ke". */
    stationLines: List<String>,
    copy: TripCopy,
    source: String?,
    /** Where the big name's bottom edge is in the root, as the page scrolls; see [PidsBar]. */
    onNameMoved: (Float) -> Unit,
    modifier: Modifier = Modifier,
) {
    when (style) {
        is PidsStyle.BekasiRailway -> BekasiRailwayBoard(style, pids, lines, stationLines, copy, source, onNameMoved, modifier)
    }
}

/** The bar over every screen while a trip runs, in [style]. */
@Composable
internal fun PidsBar(
    style: PidsStyle,
    pids: Pids,
    lines: Map<String, LineInfo>,
    copy: TripCopy,
    topInset: Dp,
    collapsed: Boolean,
    onTripPage: Boolean,
    onClose: () -> Unit,
    onOpen: () -> Unit,
    modifier: Modifier = Modifier,
) {
    when (style) {
        is PidsStyle.BekasiRailway -> BekasiRailwayBar(pids, lines, copy, topInset, collapsed, onTripPage, onClose, onOpen, modifier)
    }
}
