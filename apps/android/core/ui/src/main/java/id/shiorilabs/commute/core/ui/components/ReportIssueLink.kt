package id.shiorilabs.commute.core.ui.components

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.minimumInteractiveComponentSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import id.shiorilabs.commute.core.ui.R
import id.shiorilabs.commute.core.ui.icons.CommuteIcons
import id.shiorilabs.commute.core.ui.preview.CommutePreviewScaffold
import java.net.URLEncoder

/** The Tally form problems and suggestions go to. */
const val REPORT_ISSUE_FORM_URL = "https://tally.so/r/68BvJe"

/** The `URLEncoder` overload taking a `Charset` needs API 33; the name works everywhere. */
private const val UTF_8 = "UTF-8"

/**
 * The feedback form, with its hidden `halaman` field set to [page] when there is one: the web link of
 * the page the report is about, so it says exactly what was on screen.
 */
fun reportIssueUrl(page: String? = null): String =
    if (page.isNullOrEmpty()) REPORT_ISSUE_FORM_URL else "$REPORT_ISSUE_FORM_URL?halaman=${URLEncoder.encode(page, UTF_8)}"

/**
 * "Laporkan masalah" at the foot of a detail page, as TfL Go closes its own: a pink warning circle
 * and label, no fill, opening the feedback form about [page] (see [reportIssueUrl]).
 */
@Composable
fun ReportIssueLink(page: String?, modifier: Modifier = Modifier) {
    val uriHandler = LocalUriHandler.current
    val description = stringResource(R.string.core_ui_report_issue_description)
    val color = MaterialTheme.colorScheme.primary
    Row(
        modifier = modifier
            .minimumInteractiveComponentSize()
            .clickable(role = Role.Button) { uriHandler.openUri(reportIssueUrl(page)) }
            // Read as one button that says where it goes, rather than the label alone.
            .clearAndSetSemantics { contentDescription = description }
            .padding(vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            imageVector = CommuteIcons.ReportIssue,
            contentDescription = null,
            modifier = Modifier.size(24.dp),
            tint = color,
        )
        Text(
            text = stringResource(R.string.core_ui_report_issue),
            style = MaterialTheme.typography.bodyLarge,
            fontWeight = FontWeight.SemiBold,
            color = color,
        )
    }
}

@Preview(showBackground = true)
@Composable
private fun ReportIssueLinkPreview() {
    CommutePreviewScaffold {
        ReportIssueLink(page = "https://commute.shiorilabs.id/stations/KCI/MRI", modifier = Modifier.padding(16.dp))
    }
}
