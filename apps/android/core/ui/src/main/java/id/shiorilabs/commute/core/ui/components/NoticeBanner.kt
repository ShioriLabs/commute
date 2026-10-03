package id.shiorilabs.commute.core.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import id.shiorilabs.commute.core.ui.icons.CommuteIcons
import id.shiorilabs.commute.core.ui.preview.CommutePreviewScaffold

/** The web's `bg-amber-100` with `text-amber-950`. */
private val NoticeFill = Color(0xFFFEF3C7)
private val NoticeInk = Color(0xFF451A03)

private val IconSize = 24.dp
private val IconGap = 8.dp

/**
 * A caveat over a page: the data may be stale, or a station no longer has trains. Amber, with the
 * warning sign, as the web draws both. [detail] adds a quieter line under the message (how old the
 * data is, say), and [linkLabel] a link; both line up with its text rather than the icon.
 */
@Composable
fun NoticeBanner(
    message: String,
    modifier: Modifier = Modifier,
    detail: String? = null,
    linkLabel: String? = null,
    onLinkClick: () -> Unit = {},
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .background(NoticeFill, MaterialTheme.shapes.medium)
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(IconGap)) {
            Icon(
                imageVector = CommuteIcons.Warning,
                contentDescription = null,
                modifier = Modifier.size(IconSize),
                tint = NoticeInk,
            )
            Text(
                text = message,
                style = MaterialTheme.typography.bodyLarge,
                fontWeight = FontWeight.SemiBold,
                color = NoticeInk,
            )
        }
        if (detail != null) {
            Text(
                text = detail,
                modifier = Modifier.padding(start = IconSize + IconGap),
                style = MaterialTheme.typography.bodyMedium,
                color = NoticeInk,
            )
        }
        if (linkLabel != null) {
            Text(
                text = linkLabel,
                modifier = Modifier
                    .padding(start = IconSize + IconGap)
                    .clickable(role = Role.Button, onClick = onLinkClick),
                style = MaterialTheme.typography.bodyLarge,
                fontWeight = FontWeight.Bold,
                color = NoticeInk,
                textDecoration = TextDecoration.Underline,
            )
        }
    }
}

@Preview(showBackground = true)
@Composable
private fun NoticeBannerPreview() {
    CommutePreviewScaffold {
        NoticeBanner(
            message = "Kamu sedang offline, data mungkin tidak up-to-date",
            detail = "Terakhir diperbarui 2 jam lalu",
            modifier = Modifier.padding(16.dp),
        )
    }
}

@Preview(showBackground = true)
@Composable
private fun NoticeBannerLinkPreview() {
    CommutePreviewScaffold {
        NoticeBanner(
            message = "Mulai September 2026, seluruh operasional Stasiun Karet dipindahkan ke Stasiun BNI City",
            linkLabel = "Lihat BNI City",
            modifier = Modifier.padding(16.dp),
        )
    }
}
