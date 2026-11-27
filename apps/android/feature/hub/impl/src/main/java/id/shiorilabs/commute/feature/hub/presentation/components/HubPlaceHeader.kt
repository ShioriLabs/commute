package id.shiorilabs.commute.feature.hub.presentation.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import id.shiorilabs.commute.core.ui.components.CommuteCloseButton
import id.shiorilabs.commute.core.ui.components.CommuteIconButton
import id.shiorilabs.commute.core.ui.icons.CommuteIcons
import id.shiorilabs.commute.feature.hub.R
import id.shiorilabs.commute.feature.station.domain.LineInfo

/**
 * A place hub's header, the web's hub page header: the tiles and name, then the operator, sides and
 * lines of the member showing, with the close button beside them. [topInset] is the status bar's
 * height, carried inside so the frost reaches up behind the clock; with [onOpenPage], as in the
 * map's sheet, a button beside close opens the full page.
 */
@Composable
fun HubPlaceHeader(
    selection: HubSelection,
    lines: Map<String, LineInfo>,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
    topInset: Dp = 0.dp,
    onOpenPage: (() -> Unit)? = null,
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(top = topInset)
            // The web's p-8 pb-4, as on the station page.
            .padding(start = 32.dp, top = 32.dp, end = 32.dp, bottom = 16.dp),
        horizontalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            HubPlaceTitle(selection)
            HubMemberSummary(selection, lines)
        }
        if (onOpenPage != null) {
            CommuteIconButton(onClick = onOpenPage, modifier = Modifier.size(32.dp)) {
                Icon(
                    imageVector = CommuteIcons.ExternalLink,
                    contentDescription = stringResource(R.string.hub_open_page_description),
                    modifier = Modifier.size(24.dp),
                    tint = MaterialTheme.colorScheme.onBackground,
                )
            }
        }
        CommuteCloseButton(
            onClick = onClose,
            contentDescription = stringResource(R.string.hub_close_description),
            tint = MaterialTheme.colorScheme.onBackground,
        )
    }
}
