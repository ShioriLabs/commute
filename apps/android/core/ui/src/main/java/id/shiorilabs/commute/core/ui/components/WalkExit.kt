package id.shiorilabs.commute.core.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
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
 * `Keluar lewat pintu [C]` under a transfer, worded as the station page words it. Draws nothing for
 * a walk with no exit on record, which is most of them: the pins are backfilled station by station.
 */
@Composable
fun WalkExit(exit: String?, color: Color, modifier: Modifier = Modifier) {
    if (exit == null) {
        return
    }
    Row(
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(text = stringResource(R.string.core_ui_walk_exit), style = MaterialTheme.typography.bodyMedium, color = color)
        ExitBadge(code = exit)
    }
}

@Preview(showBackground = true)
@Composable
private fun WalkExitPreview() {
    CommutePreviewScaffold {
        WalkExit(exit = "C", color = Color(0xFF64748B))
    }
}
