package id.shiorilabs.commute.feature.trip.presentation

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import id.shiorilabs.commute.core.ui.preview.CommutePreviewScaffold
import id.shiorilabs.commute.feature.station.domain.LineInfo
import java.time.Instant

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

    /** "PIDS Yishun" in Experimental: SMRT's strip map, a straight line of the stops near the rider and the one to get off at. */
    data object Yishun : PidsStyle
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
    /** [PidsStyle.Yishun]'s stops; see [yishunStrip]. */
    strip: YishunStrip? = null,
    /** Every station's lines, keyed by station id, for [PidsStyle.Yishun]'s roundels under each stop. */
    allStationLines: Map<String, List<String>> = emptyMap(),
) {
    when (style) {
        is PidsStyle.BekasiRailway -> BekasiRailwayBoard(style, pids, lines, stationLines, copy, source, onNameMoved, modifier)
        PidsStyle.Yishun -> YishunBoard(pids, strip, lines, allStationLines, copy, source, onNameMoved, modifier)
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
        // Yishun keeps the same bar: it's already the dark band SMRT's panel sits under.
        is PidsStyle.BekasiRailway, PidsStyle.Yishun -> BekasiRailwayBar(pids, lines, copy, topInset, collapsed, onTripPage, onClose, onOpen, modifier)
    }
}

@Preview(showBackground = true, heightDp = 900)
@Composable
private fun PidsBoardPreview() {
    val context = LocalContext.current
    val now = Instant.now()
    val trip = TripPreviewData.riding(now)
    val pids = trip.pids(now)
    val copy = TripCopy(context.resources, TripPreviewData.lines)
    CommutePreviewScaffold {
        Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
            listOf(PidsStyle.BekasiRailway(), PidsStyle.BekasiRailway(diagram = false), PidsStyle.Yishun).forEach { style ->
                PidsBoard(
                    style = style,
                    pids = pids,
                    lines = TripPreviewData.lines,
                    stationLines = TripPreviewData.stationLines[pids.stationId].orEmpty(),
                    copy = copy,
                    source = null,
                    onNameMoved = {},
                    strip = trip.yishunStrip(pids, now),
                    allStationLines = TripPreviewData.stationLines,
                )
            }
        }
    }
}

@Preview(showBackground = true)
@Composable
private fun PidsBarPreview() {
    val context = LocalContext.current
    val now = Instant.now()
    val pids = TripPreviewData.riding(now).pids(now)
    CommutePreviewScaffold {
        PidsBar(
            style = PidsStyle.BekasiRailway(),
            pids = pids,
            lines = TripPreviewData.lines,
            copy = TripCopy(context.resources, TripPreviewData.lines),
            topInset = 0.dp,
            collapsed = false,
            onTripPage = false,
            onClose = {},
            onOpen = {},
        )
    }
}
