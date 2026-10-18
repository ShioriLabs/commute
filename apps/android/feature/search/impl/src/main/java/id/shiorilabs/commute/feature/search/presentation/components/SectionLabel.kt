package id.shiorilabs.commute.feature.search.presentation.components

import androidx.compose.ui.tooling.preview.Preview
import id.shiorilabs.commute.core.ui.preview.CommutePreviewScaffold
import id.shiorilabs.commute.core.ui.theme.Slate500
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

/** Section labels in the idle state, `text-slate-500`. */
internal val SectionLabelColor: Color
    @Composable get() = Slate500

/** A quiet label over an idle-state section: small, bold, grey. */
@Composable
fun SectionLabel(
    text: String,
    modifier: Modifier = Modifier,
) {
    Text(
        text = text,
        modifier = modifier,
        style = MaterialTheme.typography.bodyMedium,
        fontWeight = FontWeight.Bold,
        color = SectionLabelColor,
    )
}

@Preview(showBackground = true)
@Composable
private fun SectionLabelPreview() {
    CommutePreviewScaffold { SectionLabel(text = "Terakhir dicari", modifier = Modifier.padding(16.dp)) }
}
