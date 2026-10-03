package id.shiorilabs.commute.feature.station.presentation.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import id.shiorilabs.commute.core.ui.ext.parseHexColor
import id.shiorilabs.commute.core.ui.ext.tint
import id.shiorilabs.commute.core.ui.preview.CommutePreviewScaffold
import id.shiorilabs.commute.feature.station.R
import id.shiorilabs.commute.feature.station.domain.LastTrainDestination
import id.shiorilabs.commute.feature.station.domain.LastTrainLine
import id.shiorilabs.commute.feature.station.domain.LineInfo
import id.shiorilabs.commute.feature.station.domain.formatClock

// Tailwind's colours, as the web's last-departures card uses them.
private val Slate400 = Color(0xFF94A3B8)
private val Slate600 = Color(0xFF475569)
private val Slate800 = Color(0xFF1E293B)
private val Slate900 = Color(0xFF0F172A)
private val Gray500 = Color(0xFF6B7280)

/** The "Kereta terakhir" heading, over the cards [LastTrainCard] draws one per line. */
@Composable
fun LastTrainsHeading(modifier: Modifier = Modifier) {
    SectionHeading(stringResource(R.string.station_last_trains_title), modifier)
}

/**
 * One line's last departures, the web's `LastDepartures` card: the line's tint, its name under a
 * dot of its colour, then a row per terminus with its last three times, the very last in bold.
 */
@Composable
fun LastTrainCard(
    line: LastTrainLine,
    lineInfo: LineInfo?,
    modifier: Modifier = Modifier,
) {
    val lineColor = lineInfo?.colorCode?.let { parseHexColor(it) } ?: Slate400
    val divider = lineColor.tint(0.3f)
    val name = lineInfo?.name ?: line.lineKey
    val description = stringResource(R.string.station_last_trains_description, name)

    Column(
        modifier = modifier
            .fillMaxWidth()
            .shadow(8.dp, RoundedCornerShape(12.dp))
            .clip(RoundedCornerShape(12.dp))
            .background(lineColor.tint(0.065f))
            .semantics { contentDescription = description },
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                Modifier
                    .size(10.dp)
                    .background(lineColor, CircleShape),
            )
            Text(
                text = name,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onBackground,
            )
        }
        HorizontalDivider(thickness = 2.dp, color = divider)
        line.destinations.forEachIndexed { index, destination ->
            if (index > 0) {
                HorizontalDivider(color = divider)
            }
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 10.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = destination.boundFor,
                        style = MaterialTheme.typography.bodyMedium,
                        color = Slate800,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    destination.via?.let { via ->
                        Text(
                            text = stringResource(R.string.station_via, via),
                            style = MaterialTheme.typography.bodySmall,
                            color = Gray500,
                        )
                    }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    destination.minutes.forEachIndexed { i, minute ->
                        val last = i == destination.minutes.lastIndex
                        val time = formatClock(minute)
                        val lastDescription = stringResource(R.string.station_last_train_time, time)
                        Text(
                            text = time,
                            modifier = if (last) Modifier.semantics { contentDescription = lastDescription } else Modifier,
                            style = MaterialTheme.typography.bodyLarge,
                            fontWeight = if (last) FontWeight.Bold else FontWeight.Medium,
                            color = if (last) Slate900 else Slate600,
                        )
                    }
                }
            }
        }
    }
}

@Preview(showBackground = true)
@Composable
private fun LastTrainCardPreview() {
    CommutePreviewScaffold {
        LastTrainCard(
            line = LastTrainLine(
                lineKey = "KCI:B",
                destinations = listOf(
                    LastTrainDestination("g:Bogor:", "Bogor", null, listOf(1390, 1420, 15)),
                    LastTrainDestination("g:Depok:", "Depok", "Pasar Minggu", listOf(1350, 1380, 1410)),
                ),
            ),
            lineInfo = LineInfo("Lin Bogor", "B", "#EE3D43", "KCI"),
            modifier = Modifier.padding(16.dp),
        )
    }
}
