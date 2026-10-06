package id.shiorilabs.commute.feature.search.presentation.components

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.scale
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.shiorilabs.commute.core.ui.components.CommuteIconButton
import id.shiorilabs.commute.core.ui.components.LineRoundel
import id.shiorilabs.commute.core.ui.components.RoundelSize
import id.shiorilabs.commute.core.ui.icons.CommuteIcons
import id.shiorilabs.commute.core.ui.preview.CommutePreviewScaffold
import id.shiorilabs.commute.feature.search.R
import id.shiorilabs.commute.feature.search.domain.SearchLine
import id.shiorilabs.commute.feature.search.domain.Searchable
import id.shiorilabs.commute.feature.search.presentation.highlightMatch
import id.shiorilabs.commute.feature.station.presentation.sharedLineRoundel
import id.shiorilabs.commute.feature.station.presentation.sharedStationName

/** The subtitle beside a result's title, `text-slate-500`. */
private val SubtitleColor = Color(0xFF64748B)

/** An unpinned pin, `text-slate-300`. */
private val PinIdle = Color(0xFFCBD5E1)

/** The hairline between rows, `bg-stone-200/70`. */
private val Hairline = Color(0xB3E7E5E4)

/** Where the text, and so the hairline, starts. */
private val RowInset = 32.dp

/**
 * One search result or recent search: the title with the matched part in the brand colour and its
 * subtitle, the roundels of the lines serving it (or a line's own pill) underneath, and for a
 * station an OTW button that plans a trip there, as the station page's "OTW Ke Sini" does, and a
 * pin that saves it to the home screen.
 *
 * Rows are separated by a hairline that starts at the text edge and runs off the right, rather than
 * boxed in; [showDivider] is false on the last row.
 *
 * @param pinned whether the station is saved; ignored for hubs and lines, which can't be.
 * @param shared whether this is the row the rider opened, whose name and roundels fly into the
 *   station page and back. Only one row on screen may be, as the same station can be listed twice.
 */
@Composable
fun SearchResultItem(
    searchable: Searchable,
    query: String,
    onClick: () -> Unit,
    pinned: Boolean,
    onTogglePin: (stationId: String) -> Unit,
    onOtw: (stationId: String) -> Unit,
    modifier: Modifier = Modifier,
    showDivider: Boolean = true,
    shared: Boolean = false,
) {
    val highlight = MaterialTheme.colorScheme.primary
    val title = remember(searchable, query, highlight) { searchable.title.highlightMatch(query, highlight) }
    val stationId = (searchable as? Searchable.Station)?.stationId
    val sharedStationId = stationId?.takeIf { shared }

    Row(
        modifier = modifier
            .fillMaxWidth()
            .drawBehind {
                if (showDivider) {
                    val y = size.height - 0.5.dp.toPx()
                    drawLine(Hairline, Offset(RowInset.toPx(), y), Offset(size.width, y), 1.dp.toPx())
                }
            }
            .padding(start = RowInset, end = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(
            modifier = Modifier
                .weight(1f)
                .heightIn(min = 64.dp)
                .clickable(onClick = onClick)
                .padding(vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp, Alignment.CenterVertically),
        ) {
            // The title stands apart from its subtitle so it alone can fly into the station page's
            // header.
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text(
                    text = title,
                    modifier = Modifier
                        .alignByBaseline()
                        .then(sharedStationId?.let { Modifier.sharedStationName(it) } ?: Modifier),
                    style = MaterialTheme.typography.titleMedium.copy(fontSize = 18.sp, lineHeight = 22.sp),
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onBackground,
                )
                searchable.subtitle?.let { subtitle ->
                    Text(
                        text = subtitle,
                        modifier = Modifier.alignByBaseline(),
                        fontSize = 14.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = SubtitleColor,
                    )
                }
            }
            when (searchable) {
                is Searchable.Station -> LineRoundels(searchable.lines, sharedStationId)
                is Searchable.Hub -> LineRoundels(searchable.lines)
                is Searchable.Line -> LinePill(searchable.line)
            }
        }
        if (stationId != null) {
            CommuteIconButton(
                onClick = { onOtw(stationId) },
                modifier = Modifier.size(44.dp),
            ) {
                // Mirrored to point right, as the station page draws it.
                Icon(
                    imageVector = CommuteIcons.NavigationArrow,
                    contentDescription = stringResource(R.string.search_otw, searchable.title),
                    modifier = Modifier
                        .size(24.dp)
                        .scale(scaleX = -1f, scaleY = 1f),
                    tint = MaterialTheme.colorScheme.primary,
                )
            }
            val haptics = LocalHapticFeedback.current
            CommuteIconButton(
                onClick = {
                    haptics.performHapticFeedback(if (pinned) HapticFeedbackType.ToggleOff else HapticFeedbackType.ToggleOn)
                    onTogglePin(stationId)
                },
                modifier = Modifier.size(44.dp),
            ) {
                Icon(
                    imageVector = if (pinned) CommuteIcons.Pinned else CommuteIcons.Pin,
                    contentDescription = stringResource(
                        if (pinned) R.string.search_unpin else R.string.search_pin,
                        searchable.title,
                    ),
                    modifier = Modifier.size(24.dp),
                    tint = if (pinned) MaterialTheme.colorScheme.primary else PinIdle,
                )
            }
        }
    }
}

/** With [sharedStationId], the roundels fly into that station page's header. */
@Composable
private fun LineRoundels(lines: List<SearchLine>, sharedStationId: String? = null) {
    if (lines.isEmpty()) {
        return
    }
    FlowRow(
        horizontalArrangement = Arrangement.spacedBy(4.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        lines.forEach { line ->
            LineRoundel(
                code = line.lineCode,
                color = line.colorCode,
                operator = line.operator,
                size = RoundelSize.SM,
                // The code inside the roundel means little read aloud; the line's name is what a
                // screen reader says instead.
                modifier = Modifier
                    .then(sharedStationId?.let { Modifier.sharedLineRoundel(it, line.key) } ?: Modifier)
                    .clearAndSetSemantics { contentDescription = line.name },
            )
        }
    }
}

@Preview(showBackground = true, backgroundColor = 0xFFFFFFFF)
@Composable
private fun SearchResultItemPreview() {
    CommutePreviewScaffold {
        SearchResultItem(
            searchable = Searchable.Station(
                title = "Manggarai",
                to = "/stations/KCI/MRI",
                keywords = listOf("manggarai", "mri"),
                subtitle = "Commuter Line",
                score = 95.0,
                stationId = "KCI-MRI",
                operator = "KCI",
                lines = listOf(
                    SearchLine("Lin Bogor", "B", "#EE3D43", "KCI"),
                    SearchLine("Lin Cikarang", "C", "#25B8EB", "KCI"),
                ),
            ),
            query = "mangga",
            onClick = {},
            pinned = true,
            onTogglePin = {},
            onOtw = {},
        )
    }
}
