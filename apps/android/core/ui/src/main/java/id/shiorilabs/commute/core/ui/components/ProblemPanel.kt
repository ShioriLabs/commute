package id.shiorilabs.commute.core.ui.components

import androidx.compose.ui.tooling.preview.Preview
import id.shiorilabs.commute.core.ui.preview.CommutePreviewScaffold
import id.shiorilabs.commute.core.ui.theme.Slate700
import id.shiorilabs.commute.core.ui.theme.Rose50
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

/** The failure panel, the web's `bg-rose-50` with `text-slate-700`. */
private val ProblemFill: Color
    @Composable get() = Rose50
private val ProblemInk: Color
    @Composable get() = Slate700

/**
 * Something on the page that didn't load: a short [message] and a retry button. Inline, in place of
 * the part that failed, rather than a full-screen empty state.
 */
@Composable
fun ProblemPanel(
    message: String,
    retryLabel: String,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .background(ProblemFill, MaterialTheme.shapes.medium)
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            text = message,
            style = MaterialTheme.typography.bodyLarge,
            fontWeight = FontWeight.SemiBold,
            color = ProblemInk,
        )
        CommuteButton(
            text = retryLabel,
            onClick = onRetry,
        )
    }
}

@Preview(showBackground = true)
@Composable
private fun ProblemPanelPreview() {
    CommutePreviewScaffold {
        ProblemPanel(
            message = "Jadwal belum bisa dimuat.",
            retryLabel = "Coba lagi",
            onRetry = {},
            modifier = Modifier.padding(16.dp),
        )
    }
}
