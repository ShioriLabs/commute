package id.shiorilabs.commute.core.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import id.shiorilabs.commute.core.ui.ext.tint
import id.shiorilabs.commute.core.ui.preview.CommutePreviewScaffold

/**
 * The raised card departures sit on, the web's `rounded-xl shadow-lg`: medium corners and an 8dp
 * shadow, filled with [color], usually a line's own tint. Its shape comes after [modifier], so the
 * caller's padding stays outside the corners.
 */
@Composable
fun CommuteCard(
    color: Color,
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    val shape = MaterialTheme.shapes.medium
    Column(
        modifier = modifier
            .fillMaxWidth()
            .shadow(8.dp, shape)
            .clip(shape)
            .background(color),
        content = content,
    )
}

@Preview(showBackground = true)
@Composable
private fun CommuteCardPreview() {
    CommutePreviewScaffold {
        CommuteCard(color = Color(0xFF25B8EB).tint(0.065f), modifier = Modifier.padding(16.dp)) {
            Text(text = "Bogor", modifier = Modifier.padding(16.dp))
        }
    }
}
