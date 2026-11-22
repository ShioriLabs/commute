package id.shiorilabs.commute.feature.map.presentation

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import id.shiorilabs.commute.feature.map.R

/**
 * "Debug Peta", Experimental "Panel Debug Peta": tools for checking Peta Bus on the streets layer,
 * one item under another. First, how the route lines are drawn: [StreetsLines].
 */
@Composable
internal fun MapDebugPanel(
    lines: StreetsLines,
    onLines: (StreetsLines) -> Unit,
    modifier: Modifier = Modifier,
) {
    val title = stringResource(R.string.map_debug_title)
    Surface(
        modifier = modifier.width(DEBUG_CARD_WIDTH).semantics { paneTitle = title },
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.surfaceContainerLowest,
        shadowElevation = 12.dp,
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(text = title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(text = stringResource(R.string.map_debug_lines), style = MaterialTheme.typography.labelLarge)
                Choice(
                    options = listOf(
                        stringResource(R.string.map_debug_lines_raw) to StreetsLines.RAW,
                        stringResource(R.string.map_debug_lines_processed) to StreetsLines.PROCESSED,
                        stringResource(R.string.map_debug_lines_adjusted) to StreetsLines.ADJUSTED,
                    ),
                    picked = lines,
                    onPick = onLines,
                )
            }
        }
    }
}

/** A few options side by side in one rounded track, the picked one filled: a segmented control. */
@Composable
private fun <T> Choice(options: List<Pair<String, T>>, picked: T, onPick: (T) -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(percent = 50))
            .background(MaterialTheme.colorScheme.surfaceContainerHigh)
            .padding(3.dp)
            .selectableGroup(),
        horizontalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        for ((label, value) in options) {
            val on = value == picked
            Box(
                modifier = Modifier
                    .weight(1f)
                    .clip(RoundedCornerShape(percent = 50))
                    .background(if (on) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceContainerHigh)
                    .clickable(role = Role.RadioButton) { onPick(value) }
                    .semantics { selected = on }
                    .padding(vertical = 8.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = label,
                    style = MaterialTheme.typography.labelMedium,
                    fontWeight = if (on) FontWeight.Bold else FontWeight.Medium,
                    color = if (on) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurface,
                )
            }
        }
    }
}

private val DEBUG_CARD_WIDTH = 260.dp
