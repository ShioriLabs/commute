package id.shiorilabs.commute.feature.line.presentation

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier

/**
 * A line's page as the map's sheet shows it, the web's LineSheet: its roundel and name, then its
 * stations down a rail. A seam, as the journey feature's OtwPanel is: the map may not depend on
 * the line feature's implementation.
 */
interface LineSheet {

    /**
     * Line [lineCode] of [operator]'s content, its name and colour ([title], [colorCode]) standing
     * in while it loads. [onClose] closes the sheet; [onBack], when there is somewhere to go back
     * to, returns to the station it was opened from; [onOpenPage] opens the full page, null for a
     * line with none; [onOpenStation] is a stop tapped, by its `OPERATOR-CODE`; [onOpenLine] is
     * another line's badge, by its `OPERATOR:CODE`.
     */
    @Composable
    fun Content(
        operator: String,
        lineCode: String,
        title: String,
        colorCode: String,
        onClose: () -> Unit,
        onBack: (() -> Unit)?,
        onOpenPage: (() -> Unit)?,
        onOpenStation: (stationId: String) -> Unit,
        onOpenLine: (lineKey: String) -> Unit,
        modifier: Modifier,
    )
}
