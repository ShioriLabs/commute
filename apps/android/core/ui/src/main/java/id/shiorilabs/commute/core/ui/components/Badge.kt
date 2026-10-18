package id.shiorilabs.commute.core.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import id.shiorilabs.commute.core.ui.preview.CommutePreviewScaffold

/**
 * A small pink tag: bold caps on the accent, like "TURUN" under a stop or "BETA" on a setting. It is
 * read out as [contentDescription] when given, otherwise as its [text].
 */
@Composable
fun Badge(text: String, modifier: Modifier = Modifier, contentDescription: String? = null) {
    Text(
        text = text,
        modifier = modifier
            .clip(RoundedCornerShape(4.dp))
            .background(MaterialTheme.colorScheme.primary)
            .padding(horizontal = 6.dp, vertical = 1.dp)
            .then(
                if (contentDescription != null) {
                    Modifier.clearAndSetSemantics { this.contentDescription = contentDescription }
                } else {
                    Modifier
                },
            ),
        style = MaterialTheme.typography.labelSmall,
        fontWeight = FontWeight.Bold,
        color = MaterialTheme.colorScheme.onPrimary,
    )
}

@Preview(showBackground = true)
@Composable
private fun BadgePreview() {
    CommutePreviewScaffold {
        Row(modifier = Modifier.padding(16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Badge(text = "TURUN")
            Badge(text = "BETA")
        }
    }
}
