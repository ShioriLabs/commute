package id.shiorilabs.commute.core.ui.components

import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.shiorilabs.commute.core.ui.preview.CommutePreviewScaffold
import id.shiorilabs.commute.core.ui.theme.Slate400

/**
 * The small capitals over a section, the web's `text-xs font-bold uppercase tracking-wide
 * text-slate-400`. [modifier] carries the section's padding.
 */
@Composable
fun SectionLabel(text: String, modifier: Modifier = Modifier, color: Color = Slate400) {
    Text(
        text = text.uppercase(),
        modifier = modifier,
        fontSize = 12.sp,
        fontWeight = FontWeight.Bold,
        letterSpacing = 0.5.sp,
        color = color,
    )
}

@Preview(showBackground = true)
@Composable
private fun SectionLabelPreview() {
    CommutePreviewScaffold {
        SectionLabel(text = "Di dekat kamu", modifier = Modifier.padding(16.dp))
    }
}
