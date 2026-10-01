package id.shiorilabs.commute.feature.search.presentation.components

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight

/** Section labels in the idle state, `text-slate-500`. */
internal val SectionLabelColor = Color(0xFF64748B)

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
