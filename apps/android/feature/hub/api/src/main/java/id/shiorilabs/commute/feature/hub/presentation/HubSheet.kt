package id.shiorilabs.commute.feature.hub.presentation

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier

/**
 * A hub's page as the map's sheet shows it, the web's HubSheet: its name and kind, then its member
 * stations, or for a place hub (an integrated station, a split halte) the selected member's own
 * page under tiles and sides. A seam, as the journey feature's OtwPanel is: the map may not depend
 * on the hub feature's implementation.
 */
interface HubSheet {

    /**
     * Hub [slug]'s content, opening a place hub on member [initialMemberId] (a tapped side) or its
     * first. [onClose] closes the sheet; [onOpenPage] opens the hub's full page on the member
     * showing, by its `OPERATOR-CODE`; [onOpenStation] is a member or a transfer tapped, by the
     * same; [onOtw] is "OTW Ke Sini" on a member; [onIsolateLine] is a line card's name tapped, by
     * its `OPERATOR:CODE`: false when the map can't draw that line apart.
     */
    @Composable
    fun Content(
        slug: String,
        initialMemberId: String?,
        onClose: () -> Unit,
        onOpenPage: (memberId: String?) -> Unit,
        onOpenStation: (stationId: String) -> Unit,
        onOtw: (stationId: String) -> Unit,
        onIsolateLine: (lineKey: String) -> Boolean,
        modifier: Modifier,
    )
}
