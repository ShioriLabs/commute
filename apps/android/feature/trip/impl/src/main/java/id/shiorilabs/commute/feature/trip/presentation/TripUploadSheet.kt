package id.shiorilabs.commute.feature.trip.presentation

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import id.shiorilabs.commute.core.ui.components.CommuteBottomSheet
import id.shiorilabs.commute.core.ui.components.CommuteButton
import id.shiorilabs.commute.core.ui.components.CommuteButtonIcon
import id.shiorilabs.commute.core.ui.components.CommuteButtonText
import id.shiorilabs.commute.core.ui.components.CommuteButtonVariant
import id.shiorilabs.commute.core.ui.components.NoticeBanner
import id.shiorilabs.commute.core.ui.icons.CommuteIcons
import id.shiorilabs.commute.core.ui.theme.Slate500
import id.shiorilabs.commute.core.ui.theme.Slate900
import id.shiorilabs.commute.feature.trip.R

/** How sending a finished trip's log from its last page is going. */
internal enum class TripUploadState { IDLE, SENDING, SENT, CLOSED, EMPTY, FAILED }

/**
 * "Mau membantu Commute?" under the trip's last page, with the button that opens what an upload
 * sends; once sent, a thank-you in its place.
 */
@Composable
internal fun TripUploadPrompt(
    uploaded: Boolean,
    state: TripUploadState,
    onUpload: () -> Unit,
    onPrivacyPolicy: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var consenting by rememberSaveable { mutableStateOf(false) }
    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (uploaded) {
            Text(text = stringResource(R.string.trip_done_upload_thanks), style = MaterialTheme.typography.bodyMedium, color = Slate500)
            return@Column
        }
        Text(text = stringResource(R.string.trip_done_upload_ask), style = MaterialTheme.typography.bodyMedium, color = Slate500)
        CommuteButton(
            text = stringResource(R.string.trip_done_upload),
            onClick = { consenting = true },
            modifier = Modifier.fillMaxWidth(),
            variant = CommuteButtonVariant.Secondary,
            leadingIcon = CommuteIcons.Upload,
        )
    }
    if (consenting) {
        TripUploadSheet(state = state, onUpload = onUpload, onPrivacyPolicy = onPrivacyPolicy, onDismiss = { consenting = false })
    }
}

/** What an upload sends and what it doesn't, then the button that sends it. */
@Composable
private fun TripUploadSheet(state: TripUploadState, onUpload: () -> Unit, onPrivacyPolicy: () -> Unit, onDismiss: () -> Unit) {
    CommuteBottomSheet(
        title = stringResource(R.string.trip_done_upload),
        closeDescription = stringResource(R.string.trip_done_upload_close),
        onDismiss = onDismiss,
    ) { hide ->
        LaunchedEffect(state) {
            if (state == TripUploadState.SENT) hide()
        }
        Column(
            modifier = Modifier.padding(start = 32.dp, end = 32.dp, bottom = 32.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text(text = stringResource(R.string.trip_done_upload_intro), style = MaterialTheme.typography.bodyMedium, color = Slate500)
            Point(CommuteIcons.Train, R.string.trip_done_upload_what, R.string.trip_done_upload_what_detail)
            Point(CommuteIcons.Excluded, R.string.trip_done_upload_ends, R.string.trip_done_upload_ends_detail)
            Point(CommuteIcons.Clock, R.string.trip_done_upload_kept, R.string.trip_done_upload_kept_detail)
            val notice = when (state) {
                TripUploadState.CLOSED -> R.string.trip_done_upload_closed
                TripUploadState.EMPTY -> R.string.trip_done_upload_empty
                TripUploadState.FAILED -> R.string.trip_done_upload_failed
                else -> null
            }
            notice?.let { NoticeBanner(message = stringResource(it)) }
            Consent(onPrivacyPolicy)
            val sending = state == TripUploadState.SENDING
            CommuteButton(
                onClick = onUpload,
                modifier = Modifier.fillMaxWidth(),
                enabled = !sending && state != TripUploadState.EMPTY,
            ) {
                if (sending) {
                    CircularProgressIndicator(modifier = Modifier.size(18.dp), color = LocalContentColor.current, strokeWidth = 2.dp)
                } else {
                    CommuteButtonIcon(CommuteIcons.Upload)
                }
                CommuteButtonText(stringResource(if (sending) R.string.trip_done_upload_sending else R.string.trip_done_upload_send))
            }
        }
    }
}

/** What tapping Upload agrees to, and the policy it's under, a tap away. */
@Composable
private fun Consent(onPrivacyPolicy: () -> Unit) {
    val consent = stringResource(R.string.trip_done_upload_consent)
    val policy = stringResource(R.string.trip_done_upload_policy)
    val linkStyle = TextLinkStyles(SpanStyle(color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Bold))
    val text = buildAnnotatedString {
        append(consent)
        append(" ")
        withLink(LinkAnnotation.Clickable(tag = "privacy", styles = linkStyle) { onPrivacyPolicy() }) { append(policy) }
    }
    Text(text = text, style = MaterialTheme.typography.bodySmall, color = Slate500)
}

@Composable
private fun Point(icon: ImageVector, title: Int, detail: Int) {
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.Top) {
        Icon(imageVector = icon, contentDescription = null, modifier = Modifier.size(24.dp), tint = Slate500)
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(text = stringResource(title), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, color = Slate900)
            Text(text = stringResource(detail), style = MaterialTheme.typography.bodyMedium, color = Slate500)
        }
    }
}
