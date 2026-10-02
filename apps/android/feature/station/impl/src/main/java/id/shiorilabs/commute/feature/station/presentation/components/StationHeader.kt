package id.shiorilabs.commute.feature.station.presentation.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import id.shiorilabs.commute.core.type.UIState
import id.shiorilabs.commute.core.ui.components.LineRoundel
import id.shiorilabs.commute.core.ui.components.RoundelSize
import id.shiorilabs.commute.core.ui.components.SkeletonBlock
import id.shiorilabs.commute.core.ui.icons.CommuteIcons
import id.shiorilabs.commute.core.ui.preview.CommutePreviewScaffold
import id.shiorilabs.commute.feature.station.R
import id.shiorilabs.commute.feature.station.domain.LineInfo
import id.shiorilabs.commute.feature.station.domain.Station
import id.shiorilabs.commute.feature.station.domain.directionalBaseName
import id.shiorilabs.commute.feature.station.domain.sortLineKeysForDisplay

/**
 * The page's header, as the web's station page draws it: the station's roundels over its name, with
 * the pin and close buttons beside them. Skeletons stand in while the station loads; once it has
 * failed, only the close button is left.
 *
 * [topInset] is the status bar's height, carried inside the header so its background reaches up
 * behind the clock.
 */
@Composable
fun StationHeader(
    station: UIState<Station>,
    lines: Map<String, LineInfo>,
    saved: Boolean,
    onToggleSave: () -> Unit,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
    topInset: Dp = 0.dp,
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(top = topInset)
            // The web's p-8 pb-4.
            .padding(start = 32.dp, top = 32.dp, end = 32.dp, bottom = 16.dp),
        horizontalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            when (station) {
                is UIState.Idle, is UIState.Loading -> SkeletonBlock(
                    modifier = Modifier
                        .width(256.dp)
                        .height(24.dp),
                    shape = MaterialTheme.shapes.small,
                )

                is UIState.Success -> {
                    StationRoundels(station.data, lines)
                    Text(
                        text = directionalBaseName(station.data.name),
                        modifier = Modifier.semantics { heading() },
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.onBackground,
                    )
                }

                is UIState.Error -> Unit
            }
        }

        Row(
            horizontalArrangement = Arrangement.spacedBy(16.dp),
            verticalAlignment = Alignment.Top,
        ) {
            when (station) {
                is UIState.Idle, is UIState.Loading -> SkeletonBlock(
                    modifier = Modifier.size(32.dp),
                    shape = CircleShape,
                )

                is UIState.Success -> HeaderButton(
                    icon = if (saved) CommuteIcons.Unpin else CommuteIcons.Pin,
                    description = stringResource(
                        if (saved) R.string.station_unsave_description else R.string.station_save_description,
                    ),
                    onClick = onToggleSave,
                )

                is UIState.Error -> Unit
            }
            HeaderButton(
                icon = CommuteIcons.Close,
                description = stringResource(R.string.station_close_description),
                onClick = onClose,
            )
        }
    }
}

/** The lines that call here, in display order. Read out as one list of names. */
@Composable
private fun StationRoundels(station: Station, lines: Map<String, LineInfo>) {
    val keys = sortLineKeysForDisplay(station.lineKeys, station.operator)
    // Until the dictionary loads there is nothing to draw a roundel with.
    val resolved = keys.mapNotNull { lines[it] }
    if (resolved.isEmpty()) {
        return
    }
    val description = stringResource(R.string.station_lines_description, resolved.joinToString { it.name })

    FlowRow(
        modifier = Modifier.semantics(mergeDescendants = true) { contentDescription = description },
        horizontalArrangement = Arrangement.spacedBy(4.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        resolved.forEach { line ->
            LineRoundel(
                code = line.lineCode,
                color = line.colorCode,
                operator = line.operator,
                size = RoundelSize.SM,
            )
        }
    }
}

@Composable
private fun HeaderButton(
    icon: ImageVector,
    description: String,
    onClick: () -> Unit,
) {
    IconButton(
        onClick = onClick,
        modifier = Modifier.size(32.dp),
    ) {
        Icon(
            imageVector = icon,
            contentDescription = description,
            modifier = Modifier.size(24.dp),
            tint = MaterialTheme.colorScheme.onBackground,
        )
    }
}

@Preview(showBackground = true)
@Composable
private fun StationHeaderPreview() {
    CommutePreviewScaffold {
        StationHeader(
            station = UIState.Success(Station("KCI-MRI", "Manggarai", "KCI", "MRI", listOf("KCI:B", "KCI:C"))),
            lines = mapOf(
                "KCI:B" to LineInfo("Lin Bogor", "B", "#EE3D43", "KCI"),
                "KCI:C" to LineInfo("Lin Cikarang", "C", "#0084D8", "KCI"),
            ),
            saved = true,
            onToggleSave = {},
            onClose = {},
        )
    }
}

@Preview(showBackground = true)
@Composable
private fun StationHeaderLoadingPreview() {
    CommutePreviewScaffold {
        StationHeader(
            station = UIState.Loading,
            lines = emptyMap(),
            saved = false,
            onToggleSave = {},
            onClose = {},
        )
    }
}
