package id.shiorilabs.commute.feature.search.presentation.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import id.shiorilabs.commute.core.ui.ext.parseHexColor
import id.shiorilabs.commute.core.ui.ext.tint
import id.shiorilabs.commute.core.ui.icons.CommuteIcons
import id.shiorilabs.commute.feature.search.domain.Searchable
import id.shiorilabs.commute.feature.station.presentation.sharedStationName

/** The chip's name, `text-slate-900`. */
private val ChipInk = Color(0xFF0F172A)

/**
 * The pinned stations as shortcut pills under the field, each tinted from its first line with the
 * pin in that line's colour.
 *
 * The web ends the row with a pencil to the screen where pins are reordered. That screen doesn't
 * exist here yet, so neither does the pencil.
 */
@Composable
fun SavedChips(
    stations: List<Searchable.Station>,
    onClick: (Searchable.Station) -> Unit,
    modifier: Modifier = Modifier,
    isShared: (Searchable.Station) -> Boolean = { false },
) {
    if (stations.isEmpty()) {
        return
    }
    FlowRow(
        modifier = modifier.padding(top = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        stations.forEach { station ->
            val lineColor = station.lines.firstOrNull()?.let { parseHexColor(it.colorCode) }
            Row(
                modifier = Modifier
                    .clip(CircleShape)
                    .background(lineColor?.tint(0.2f) ?: MaterialTheme.colorScheme.primaryContainer)
                    .clickable { onClick(station) }
                    .padding(horizontal = 12.dp, vertical = 6.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    imageVector = CommuteIcons.Pinned,
                    contentDescription = null,
                    modifier = Modifier.size(16.dp),
                    tint = lineColor ?: MaterialTheme.colorScheme.primary,
                )
                Text(
                    text = station.title,
                    // The chip tapped hands its name to the station page's header.
                    modifier = station.stationId?.let { id -> Modifier.sharedStationName(id, enabled = isShared(station)) }
                        ?: Modifier,
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.Bold,
                    color = ChipInk,
                )
            }
        }
    }
}
