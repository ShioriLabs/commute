package id.shiorilabs.commute.core.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import id.shiorilabs.commute.core.ui.R
import id.shiorilabs.commute.core.ui.preview.CommutePreviewScaffold

/**
 * The line under a transfer's "Transit ke ...": `via Pintu [C] · Jalan kaki ±310m`.
 *
 * The exit is only said when the walk has one on record, which is most walks' honest answer: the
 * pins are backfilled station by station. Draws nothing for a walk with neither.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun WalkDetail(
    exit: String?,
    distanceM: Int,
    color: Color,
    modifier: Modifier = Modifier,
) {
    if (exit == null && distanceM <= 0) {
        return
    }
    FlowRow(
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalArrangement = Arrangement.spacedBy(2.dp),
        itemVerticalAlignment = Alignment.CenterVertically,
    ) {
        if (exit != null) {
            Text(text = stringResource(R.string.core_ui_walk_via_exit), style = MaterialTheme.typography.bodyMedium, color = color)
            ExitBadge(code = exit)
        }
        if (exit != null && distanceM > 0) {
            Text(text = "·", style = MaterialTheme.typography.bodyMedium, color = color)
        }
        if (distanceM > 0) {
            Text(text = stringResource(R.string.core_ui_walk_distance, distanceM), style = MaterialTheme.typography.bodyMedium, color = color)
        }
    }
}

@Preview(showBackground = true)
@Composable
private fun WalkDetailPreview() {
    CommutePreviewScaffold {
        WalkDetail(exit = "C", distanceM = 310, color = Color(0xFF64748B))
    }
}
